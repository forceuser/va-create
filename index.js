import process from "process";
import readline from "readline-promise";
import shell from "shelljs";
import fetch from "isomorphic-fetch";
import path from "path";
import fs from "fs-extra";
import globby from "globby";
import parseGithubUrl from "parse-github-url";
import yargs from "yargs";
import camelcase from "camelcase";
import {URL} from "universal-url";
import "colors";

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const cwd = process.cwd();
const argv = yargs(process.argv.slice(3)).argv;



async function main () {
	const data = {};

	try {
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
			terminal: true,
		});
		try {
			data.name = await rl.questionAsync("Enter project name: ");
			data.owner = await rl.questionAsync("Enter github project owner: ");
			data.src = path.resolve(__dirname, "./project");
			data.dest = path.resolve(cwd, `./${data.name}`);
			await fs.copy(data.src, data.dest, {overwrite: true});
			const pkg = JSON.parse((await fs.readFile(path.resolve(data.dest, "./package.json"), "utf8")).replace(/projectname/gm, data.name));
			pkg["va-release"].owner = data.owner;
			pkg["va-release"].library = camelcase(data.name);
			await fs.writeFile(path.resolve(data.dest, "./package.json"), JSON.stringify(pkg, null, "\t"), "utf8");
			console.log(`${"Success!".green} Project ${`${data.name}`.cyan} created at ${`${data.dest}`.cyan}`);
		}
		finally {
			rl.close();
		}
	}
	catch (error) {
		console.log("ERROR", error);
	}
	return data;
}

main();
