
import fs from 'fs';

const fileContent = fs.readFileSync('core/automation.js', 'utf8');
const match = fileContent.match(/const CAPTURE_SCRIPT = `([\s\S]+?)`;/);
const script = match[1];

// This mimics what happens when Node.js evaluates the template literal
// Actually, it doesn't quite work because the variable is already a string here.
// But I can see the content.
fs.writeFileSync('debug_script_output.js', script);
console.log('Script written to debug_script_output.js');
