import process from "process";
import readline from "readline-promise";
import shell from "shelljs";
import $path from "path";
import fs from "fs-extra";
import yargs from "yargs";
import inquirer from "inquirer";
import merge from "deepmerge";
import camelcase from "camelcase";
import open from "open";
import isWSL from "is-wsl";
import wslpath from "wsl-path";
import istextorbinary from "istextorbinary";
import "colors";

const __dirname = $path.dirname(new URL(import.meta.url).pathname);
const cwd = process.cwd();
const argv = yargs(process.argv.slice(3)).argv;

async function readln (question) {
	let result;
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
		terminal: true,
	});
	try {
		result = await rl.questionAsync(question);
	}
	finally {
		rl.close();
	}
	return result;
}
const fileRules = {
	"-npmignore": {rename: ".npmignore"},
	"package": {flags: false},
	"package.json": {flags: false},
	"babel.config.js": {flags: ["client", "lib", "babel"]},
	".browserslistrc": {flags: ["client", "lib", "babel"]},
	".travis.yml": {flags: ["travis"]},
	".nycrc.json": {flags: ["c8", "nyc"]},
	"devserver.json": {flags: ["client"]},
	"tonic-example.js": {flags: ["lib"]},
	"webpack": {flags: ["client", "lib"]},
	"dist": {flags: ["client", "lib"]},
	"src/app/server.mjs": {flags: ["server"], compile: true},
	"src/app/cli.mjs": {flags: ["cli"]},
	"src/app/index.mjs": {flags: ["client", "lib"]},
	"src/sw.js": {flags: ["client"]},
	// "utils/run.js": {flags: false},
	"utils/dev-server.mjs": {flags: ["client"]},
	"utils/invoke-middleware.mjs": {flags: ["client"]},
};


function choiseItem (argv, settings) {
	return {type: "list", choices: ["yes", "no"], default: settings[this.name]};
}

function inputItem (argv, settings) {
	return {
		type: "input",
		default: argv._[0] || settings[this.name],
		validate: val => (val || "").trim().length > 0,
	};
}

const packageRules = [
	{name: "project_name", text: "Project name:", get: inputItem},
	{name: "server", message: "Include web-server code?", get: choiseItem},
	{name: "client", message: "Include web-client code?", deps: ["webpack"], get: choiseItem},
	{name: "lib", message: "Will project be a standalone library?", get: choiseItem},
	{name: "cli", message: "Will it have command line interface?", get: choiseItem},
	{name: "github", message: "Use github repo?", ask: ["package_owner"], get: choiseItem},
	{name: "package_owner", message: "Enter github package owner", optional: true, get: inputItem},
	{name: "npm", message: "Publish to npm?", get: choiseItem},
	{name: "babel", message: "Include babel boilerlate?", get: choiseItem},
	{name: "webpack", message: "Include webpack?", get: choiseItem},
	{name: "c8", message: "Include c8 node instrumentation and coverage tool?", get: choiseItem},
	{name: "nyc", message: "Include istanbul/nyc instrumentation and coverage tool?", deps: ["webpack"], get: choiseItem},
	{name: "codecov", message: "Include codecov?", get: choiseItem},
	{name: "documentation", get: choiseItem},
];

// const flagList = ["client", "server", "cli", "lib", "github", "babel", "c8", "nyc", "codecov", "webpack", "documentation"];


function isIncluded (include, flags) {
	return include == null ||
	include === true ||
	(
		Array.isArray(include) &&
		include.some(i => flags.includes(i))
	);
}

async function copy (src, dest, flags, data) {
	async function updateFile (destPath) {
		if (istextorbinary.isText(destPath)) {
			let fileContents = (await fs.readFile(destPath, "utf8"));
			fileContents = fileContents.replace(/\{\{(.*?)\}\}/igm, (all, param) => {
				const p = data[param];
				return p == null ? `{{${param}}}` : p;
			});
			await fs.writeFile(destPath, fileContents, "utf8");
		}
	}

	const root = src;
	async function copyDir (src, dest) {
		const entries = await fs.readdir(src, {withFileTypes: true});
		if (!fs.existsSync(dest)) {
			await fs.mkdirp(dest);
		}
		for (const entry of entries) {
			const srcPath = $path.resolve(src, entry.name);
			const relPath = $path.relative(root, srcPath);
			const rule = fileRules[relPath];
			// console.log("relPath", relPath);
			if (!rule || rule.flags == null || (Array.isArray(rule.flags) && rule.flags.some(flag => flags.has(flag)))) {
				const destPath = $path.resolve(dest, rule && rule.rename ? rule.rename : entry.name);
				if (entry.isDirectory()) {
					await copyDir(srcPath, destPath);
				}
				else {
					await fs.copyFile(srcPath, destPath);
					await updateFile(destPath);
				}
			}
			else if (fs.existsSync($path.resolve(dest, entry.name))) {
				await updateFile($path.resolve(dest, entry.name));
			}

		}
	}

	return copyDir(src, dest);
}



async function main () {
	const dir = __dirname;
	await fs.ensureFile($path.resolve(dir, "./settings.json"));
	const settings = JSON.parse((await fs.readFile($path.resolve(dir, "./settings.json"), "utf8")) || "{}");

	try {
		console.log("Let's create a new project", ":)".green);
		const flags = new Set();
		const ask = new Set();
		let data = {};
		await packageRules.reduce(async (prev, rule) => {
			await prev;
			if ((!rule.optional || ask.has(rule.name)) && !flags.has(rule.name)) {
				if (rule.get) {
					rule = Object.assign(rule, rule.get(argv, settings));
				}
				const d = await inquirer.prompt([rule]);
				if (rule.type === "list" && d[rule.name] === "yes") {
					flags.add(rule.name);
					if (rule.deps) {
						rule.deps.forEach(flag => {
							flags.add(flag);
							data[flag] = "yes";
						});
					}
					if (rule.ask) {
						rule.ask.forEach(flag => ask.add(flag));
					}
				}
				data = Object.assign(data, d);
			}
		}, {});

		Object.assign(settings, data);
		data.src = $path.resolve(__dirname, "./project");
		data.dest = $path.resolve(cwd, `./${data.project_name}`);
		await fs.writeFile($path.resolve(dir, "./settings.json"), JSON.stringify(settings, null, "\t"), "utf8");

		const readJson = async (fileName) => JSON.parse(await fs.readFile($path.resolve(data.src, fileName), "utf8"));
		let pkg = JSON.parse((await fs.readFile($path.resolve(data.src, "./package.json"), "utf8")));// .replace(/projectname/gm, data.name).replace(/projectowner/gm, data.owner));
		pkg["va-release"].library = camelcase(data.project_name);

		if (!flags.has("npm")) {
			pkg.private = true;
			pkg["va-release"].flags = pkg["va-release"].flags || [];
			pkg["va-release"].flags.push("no-npm");
		}
		if (!flags.has("github")) {
			pkg["va-release"].flags = pkg["va-release"].flags || [];
			pkg["va-release"].flags.push("no-github");
		}

		if (flags.has("babel")) {
			pkg["va-release"].babel = true;
		}

		if (flags.has("webpack")) {
			pkg["va-release"].webpack = true;
		}

		for (const rule of packageRules) {
			if (flags.has(rule.name)) {
				const p = await readJson(`./package/${rule.name}.json`);
				pkg = merge(pkg, p);
			}
		}
		await fs.ensureFile($path.resolve(data.dest, "./package.json"));
		await fs.writeFile($path.resolve(data.dest, "./package.json"), JSON.stringify(pkg, null, "\t"), "utf8");
		await copy(data.src, data.dest, flags, data);

		console.log(`${"Success!".green} Project ${`${data.project_name}`.cyan} created at ${`${data.dest}`.cyan}`);

		open(isWSL ? shell.exec(`wslpath -w ${data.dest}`, {silent: true}).toString() : data.dest, {app: "code"});
		process.exit(0);
	}
	catch (error) {
		console.log(`${"Error!".red} Failed to create project`);
		console.log(error);
		process.exit(1);
	}
}

main();
