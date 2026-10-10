import {readFileSync} from 'node:fs';
import {validateExportProject} from './project-validation.mjs';
try{await validateExportProject(JSON.parse(readFileSync(process.argv[2],'utf8')),process.argv[3]);}catch(error){console.error(error.message);process.exitCode=1;}
