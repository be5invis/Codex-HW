"use strict";

const which = require("which");
const FgRed = "\x1b[31m";
const FgGreen = "\x1b[32m";
const FgYellow = "\x1b[33m";
const Reset = "\x1b[0m";

console.log("Checking External Dependencies");
check("ttfautohint");

function check(util) {
	try {
		which.sync(util);
		console.error(FgGreen + ` * External dependency <${util}> is present.` + Reset);
	} catch (e) {
		console.error(FgRed + ` * External dependency <${util}> is not found.` + Reset);
	}
}
