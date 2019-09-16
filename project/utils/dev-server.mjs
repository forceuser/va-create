#!/usr/bin/env node
import process from "process";
import path from "path";
import fp from "find-free-port";
import fs from "fs-extra";
import os from "os";
import url from "url";
import yargs from "yargs";
import http2 from "http2";
import minimatch from "minimatch";
import merge from "deepmerge";
import webpack from "webpack";
import webpackDevMiddleware from "webpack-dev-middleware";
import webpackHotMiddleware from "webpack-hot-middleware";
import webpackConfigRaw from "../webpack/development.config.js";
import proxyMiddleware from "http-proxy-middleware";
import invokeMiddleware from "./invoke-middleware";
// import {URL} from "universal-url";
import browserSync from "browser-sync";
import syncDir from "sync-directory";
import open from "open";
// import ngrok from "ngrok";

const cwd = process.cwd();
const argv = yargs
	.alias("port", "p")
	.describe("port", "port to start dev server")
	.env("DEV_ENV")
	.option("env", {alias: "env"})
	.help("help")
	.argv;

function getJSON (uri) {
	try {
		return JSON.parse(fs.readFileSync(path.resolve(packageDir, uri), "utf8"));
	}
	catch (error) {
		return {};
	}
}

function get (src, path) {
	const p = path.replace(/["']/g, "").replace(/\[/g, ".").replace(/\]/g, "").split(".");
	let c = src;
	if (p[0]) {
		for (let i = 0; i < p.length; i++) {
			if (i === p.length - 1) {
				return c[p[i]];
			}
			c = c[p[i]];
			if (c == null || typeof c !== "object") {
				return undefined;
			}
		}
	}
	return c;
}

function tpl (tpl, params) {
	tpl = tpl.replace(/\$\{(.*?)\}/igm, (all, param) => {
		const p = get(params, param);
		return p == null ? `[${param}]` : p;
	});
	return tpl;
}

function fileExists (path) {
	try {
		if (fs.existsSync(path)) {
			return true;
		}
	}
	catch (err) {
		console.error(err);
	}
	return false;
}

function getPackageDir () {
	let p = "./";
	let ex;
	while (!(ex = fileExists(path.resolve(cwd, p, "package.json")), ex) && path.resolve(cwd, p) !== path.resolve("/")) {
		p = p === "./" ? "../" : `${p}../`;
	}
	if (ex) {
		return path.resolve(cwd, p);
	}
}

const packageDir = getPackageDir();
const __dirname = path.dirname(new URL(import.meta.url).pathname);

const devSettingsDefault = {host: "0.0.0.0"};
const pkg = getJSON("package.json");
let devSettings = merge(merge(devSettingsDefault, pkg.devSettings || {}), getJSON("devserver.json"));

if (argv.env) {
	argv.env.split(",").forEach(env => {
		if (devSettings.env && devSettings.env[env]) {
			devSettings = merge(devSettings, devSettings.env[env]);
		}
	});
}

const ifc = os.networkInterfaces();

async function runOnPort (port) {
	devSettings.baseDir = devSettings.baseDir || "./dist/";
	devSettings.watchFiles = devSettings.watchFiles || ["dist/**/*"];
	devSettings.spaPaths = devSettings.spaPaths || [];

	const proxyMiddlewares = devSettings.proxy ? [
		proxyMiddleware("**", {
			target: tpl(devSettings.proxy, devSettings),
			secure: false,
			changeOrigin: devSettings.changeOrigin !== false,
		}),
	] : [];

	const webpackCompiler = webpack((devSettings.webpackEnv || [{}]).map(env => {
		return typeof webpackConfigRaw === "function" ? webpackConfigRaw(env) : webpackConfigRaw;
	}));
	const webpackDevInstance = webpackDevMiddleware(webpackCompiler, {
		// publicPath: webpackConfig.output.publicPath,
		stats: "errors-only",
	});

	const webpackMiddlewares = [
		webpackDevInstance,
		webpackHotMiddleware(webpackCompiler, {
			path: "/__webpack_hmr",
			reload: true,
		}),
	];

	const middleware = [
		...webpackMiddlewares,
		async (req, res, next) => {
			let fileName = url.parse(req.url);
			fileName = fileName.href.split(fileName.search).join("");
			let match;

			if (devSettings.rewrite) {
				for (const src of Object.keys(devSettings.rewrite)) {
					if (minimatch(fileName, src)) {
						req.url = devSettings.rewrite[src];
						return next();
					}
				}
			}

			if (devSettings.spaPaths && devSettings.spaPaths.some(key => minimatch(fileName, key))) {
				req.url = `/`;

				return next();
			}

			match = fileName.match(/^\/resources\/[^/\\]+\/js\/(.*)/);
			if (match && match[1]) {
				req.url = `/resources/${pkg.version}/js/${match[1]}`;
				return invokeMiddleware(webpackMiddlewares, req, res);
			}

			match = fileName.match(/^\/resources\/[^/\\]+\/(.*)/);
			if (match && match[1]) {
				req.url = `/${match[1]}`;
				return next();
			}

			match = fileName.match(/^\/res\/(.*)/);
			if (match && match[1]) {
				req.url = `/${match[1]}`;
				return next();
			}

			let pathExists;
			try {
				const p = path.resolve(packageDir, devSettings.baseDir, req.url.replace(/^\//, ""));
				const stat = (await fs.stat(p));
				if (stat.isFile()) {
					return next();
				}
				else if (stat.isDirectory() && devSettings.indexFiles) {
					const indexFiles = devSettings.indexFiles === true ? ["index.html"] : devSettings.indexFiles;
					for (let i = 0; i < indexFiles.length; i++) {
						const idx = indexFiles[i];
						if (await fs.exists(path.resolve(p, idx))) {
							req.url = req.url.replace(/^\//, "/" + idx);
							return next();
						}
					}
				}
			}
			catch (error) {
				//
			}

			if (proxyMiddlewares.length) {
				return invokeMiddleware(proxyMiddlewares, req, res);
			}
			else {
				return next();
			}
		},
	];

	const bs = browserSync.create();
	bs.init({
		open: false,
		notify: false,
		// online: false,
		// localOnly: true,
		// host: devSettings.host,
		port,
		files: devSettings.watchFiles,
		// watchEvents: ["change", "add", "unlink"],
		reloadDebounce: 300,
		ghostMode: {
			clicks: false,
			forms: false,
			scroll: false,
		},
		watchOptions: {
			awaitWriteFinish: true,
		},
		server: {
			baseDir: path.resolve(packageDir, devSettings.baseDir),
			middleware,
		},
	});

	let ngrokUrl;
	if (typeof ngrok && devSettings.serveExternal) {
		try {
			ngrokUrl = await ngrok.connect(port);
		}
		catch (error) {
			console.log("ngrok error", error);
		}
	}

	setTimeout(() => {
		// if (devSettings.host === "0.0.0.0") {
		Object.keys(ifc).forEach(i => {
			(ifc[i] || []).forEach(x => {
				if (x.family === "IPv4") {
					console.log(`listening at http://${x.address}:${port}`);
				}
			});
		});


		if (devSettings.serveExternal) {
			console.log(`listening at ${ngrokUrl}`);
		}

		if (devSettings.open) {
			webpackDevInstance.waitUntilValid(() => {
				console.log("opening", tpl(devSettings.open, devSettings));
				setTimeout(() => {
					open(tpl(devSettings.open, devSettings));
				}, 1000);
			});
		}

		if (devSettings.syncDir) {
			Object.keys(devSettings.syncDir).forEach(src => {
				const target = devSettings.syncDir[src];
				syncDir(path.resolve(packageDir, src), path.resolve(packageDir, target), {watch: true, type: "copy"});
			});
		}
	}, 2000);
}
if (argv.port || devSettings.port) {
	runOnPort(argv.port || devSettings.port);
}
else {
	fp(8080).then(async ([port]) => {
		runOnPort(port);
	})
		.catch(error => {
			console.log("ERROR", error);
		});
}
