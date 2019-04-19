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
	"babel.config.js": {flags: ["client", "lib", "babel"]},
	".browserslistrc": {flags: ["client", "lib", "babel"]},
	"webpack": {flags: ["client", "lib"]},
	".travis.yml": {flags: ["travis"]},
	"dist": {flags: ["client", "lib", "server"]},
	"src/server.mjs": {flags: ["server"], compile: true},
	"src/cli.mjs": {flags: ["cli"]},
	"src/index.mjs": {flags: ["client", "lib"]},
	"utils/run.js": {flags: false},
	"utils/dev-server.mjs": {flags: ["client"]},
	"utils/invoke-middleware.mjs": {flags: ["client"]},
};

const packageRules = [
	{name: "server", flags: ["server"]},
	{name: "client", flags: ["client"]},
	{name: "cli", flags: ["cli"]},
	{name: "babel", flags: ["babel", "nyc", "client"]},
	{name: "coverage", flags: ["c8", "nyc", "coverage"]},
	{name: "c8", flags: ["c8"]},
	{name: "nyc", flags: ["nyc"]},
	{name: "webpack", flags: ["webpack", "nyc", "client"]},
	{name: "documentation", flags: ["documentation"]},
];

const flagList = ["client", "server", "cli", "lib", "babel", "coverage", "c8", "nyc", "webpack", "documentation"];


function isIncluded (include, flags) {
	return include == null ||
	include === true ||
	(
		Array.isArray(include) &&
		include.some(i => flags.includes(i))
	);
}

async function copy (src, dest, flags) {
	const root = src;
	async function copyDir (src, dest) {
		const entries = await fs.readdir(src, {withFileTypes: true});
		await fs.mkdir(dest);
		for (const entry of entries) {
			const srcPath = $path.resolve(src, entry.name);
			const relPath = $path.relative(root, srcPath);
			const rule = fileRules[relPath];
			// console.log("relPath", relPath);
			if (!rule || (rule && isIncluded(rule.flags, flags))) {
				const destPath = $path.resolve(dest, rule && rule.rename ? rule.rename : entry.name);
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
				default: argv._[0] || settings.name,
				validate: val => (val || "").trim().length > 0,
			},
			{
				type: "input",
				name: "owner",
				default: settings.owner,
				message: "github project owner",
			},
			...flagList.map(name => ({
				type: "list",
				choices: ["yes", "no"],
				name,
				default: settings[name],
			})),
		];
		const data = await inquirer.prompt(questions);
		Object.assign(settings, data);
		const flags = flagList.filter(name => data[name] === "yes");

		await fs.writeFile($path.resolve(dir, "./settings.json"), JSON.stringify(settings, null, "\t"), "utf8");

		data.src = $path.resolve(__dirname, "./project");
		data.dest = $path.resolve(cwd, `./${data.name}`);

		await copy(data.src, data.dest, flags);

		const readJson = async (fileName) => JSON.parse(await fs.readFile($path.resolve(data.src, fileName), "utf8"));
		let pkg = JSON.parse((await fs.readFile($path.resolve(data.dest, "./package.json"), "utf8")).replace(/projectname/gm, data.name).replace(/projectowner/gm, data.owner));
		pkg["va-release"].library = camelcase(data.name);

		for (const rule of packageRules) {
			if (!rule || (rule && isIncluded(rule.flags, flags))) {
				const p = await readJson(`./package/${rule.name}.json`);
				pkg = merge(pkg, p);
			}
		}

		await fs.writeFile($path.resolve(data.dest, "./package.json"), JSON.stringify(pkg, null, "\t"), "utf8");

		console.log(`${"Success!".green} Project ${`${data.name}`.cyan} created at ${`${data.dest}`.cyan}`);

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
