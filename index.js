import process from "process";
import readline from "readline-promise";
import shell from "shelljs";
import $path from "path";
import fs from "fs-extra";
import yargs from "yargs";
import inquirer from "inquirer";
import merge from "deepmerge";
import camelcase from "camelcase";
import {URL} from "universal-url";
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
	"package": {include: false},
	"babel.config.js": {include: ["client", "lib", "babel"]},
	".browserslistrc": {include: ["client", "lib", "babel"]},
	"webpack": {include: ["client", "lib"]},
	".travis.yml": {include: ["travis"]},
	"dist": {include: ["client", "lib"]},
	"src/server.js": {include: ["server"]},
	"src/cli.js": {include: ["cli"]},
	"src/index.js": {include: ["client", "lib"]},
	"utils/dev-server.js": {include: ["client"]},
	"utils/invoke-middleware.js": {include: ["client"]},
};
async function copy (src, dest, flags) {
	function isIncluded (include) {
		return include == null ||
		include === true ||
		(
			Array.isArray(include) &&
			include.some(i => flags.includes(i))
		);
	}
	const root = src;
	async function copyDir (src, dest) {
		const entries = await fs.readdir(src, {withFileTypes: true});
		await fs.mkdir(dest);
		for (const entry of entries) {
			const srcPath = $path.resolve(src, entry.name);
			const relPath = $path.relative(root, srcPath);
			const fileRule = fileRules[relPath];
			// console.log("relPath", relPath);
			if (!fileRule || (fileRule && isIncluded(fileRule.include))) {
				const destPath = $path.resolve(dest, fileRule && fileRule.rename ? fileRule.rename : entry.name);
				if (entry.isDirectory()) {
					await copyDir(srcPath, destPath);
				}
				else {
					await fs.copyFile(srcPath, destPath);
				}
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
		const questions = [
			{
				type: "input",
				name: "name",
				message: "project name",
				default: settings.name,
				validate: val => (val || "").trim().length > 0,
			},
			{
				type: "input",
				name: "owner",
				default: settings.owner,
				message: "github project owner",
			},
			{
				type: "list",
				choices: ["yes", "no"],
				name: "isClient",
				default: settings.isClient,
				message: "client web app code",
			},
			{
				type: "list",
				choices: ["yes", "no"],
				name: "isServer",
				default: settings.isServer,
				message: "server code",
			},
			{
				type: "list",
				choices: ["yes", "no"],
				name: "isCLI",
				default: settings.isCLI,
				message: "command line interface (cli) code",
			},
			{
				type: "list",
				choices: ["yes", "no"],
				name: "isLib",
				default: settings.isLib,
				message: "basic js library code",
			},
		];
		const data = await inquirer.prompt(questions);
		Object.assign(settings, data);

		const flags = [];
		if (data.isClient === "yes") {
			flags.push("client");
		}
		if (data.isServer === "yes") {
			flags.push("server");
		}
		if (data.isCLI === "yes") {
			flags.push("cli");
		}
		if (data.isLib === "yes") {
			flags.push("lib");
		}


		await fs.writeFile($path.resolve(dir, "./settings.json"), JSON.stringify(settings, null, "\t"), "utf8");

		data.src = $path.resolve(__dirname, "./project");
		data.dest = $path.resolve(cwd, `./${data.name}`);
		await copy(data.src, data.dest, flags);

		const pkg = JSON.parse((await fs.readFile($path.resolve(data.dest, "./package.json"), "utf8")).replace(/projectname/gm, data.name).replace(/projectowner/gm, data.owner));
		pkg["va-release"].library = camelcase(data.name);


		await fs.writeFile($path.resolve(data.dest, "./package.json"), JSON.stringify(pkg, null, "\t"), "utf8");

		console.log(`${"Success!".green} Project ${`${data.name}`.cyan} created at ${`${data.dest}`.cyan}`);
		process.exit(0);
	}
	catch (error) {
		console.log(`${"Error!".red} Failed to create project`);
		console.log(error);
		process.exit(1);
	}
}

main();
