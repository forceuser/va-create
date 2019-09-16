import jimp from "jimp";
import fs from "fs-extra";
import process from "process";
import path from "path";
import ssri from "ssri";
import globby from "globby";
import shell from "shelljs";
import imageDataURI from "image-data-uri";

const cwd = process.cwd();

const exec = async (command, options = {}) => {
	return new Promise((resolve, reject) => {
		shell.exec(command, {...options, async: true}, (code, stdout, stderr) => {
			if (code !== 0) {
				const error = new Error();
				error.message = stderr;
				error.name = String(code);
				reject(error);
			}
			else {
				resolve(stdout);
			}
		});
	});
};


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
async function main () {
	try {
		await fs.ensureFile(path.resolve(packageDir, "utils/image-compress.json"));
		const hashes = JSON.parse((await fs.readFile(path.resolve(packageDir, "utils/image-compress.json"), "utf8")) || "{}");
		const list = await globby(["dist/img/**/*.png"], {cwd: packageDir});

		await list.reduce(async (prev, item) => {
			await prev;
			if (!item.includes("-src")) {
				const fileDataOrig = await fs.readFile(path.resolve(packageDir, item));
				const hash = ssri.fromData(fileDataOrig);
				if (!(item in hashes) || hash === hashes[item].hash) {
					const fn = item.split(".").slice(0, -1).join(".");
					await exec(`cd ${packageDir} && pngquant -f -v --ext .png --floyd=1 --quality 85-95 ${item}`);
					const fileData = await fs.readFile(path.resolve(packageDir, item));
					hashes[item] = {hash: ssri.fromData(fileData), original: imageDataURI.encode(fileDataOrig, "PNG")};
					await exec(`cd ${packageDir} && cwebp -near_lossless 50 -m 6 -z 9 -af 1 -sns 100 -o ${fn}.webp -- ${item}`);
				}
			}
		}, {});
		await fs.writeFile(path.resolve(packageDir, "utils/image-compress.json"), JSON.stringify(hashes, null, "\t"), "utf8");
	}
	catch (error) {
		console.log("error", error);
	}
}
main();
