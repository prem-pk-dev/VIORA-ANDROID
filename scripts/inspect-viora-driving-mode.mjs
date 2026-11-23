#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(process.argv[2] || "viora-source");
const ignored = new Set(["node_modules","dist",".git","coverage","build"]);
const exts = new Set([".js",".mjs",".cjs",".ts",".html",".css"]);
const patterns = [
  ["driving-mode", /driving.?mode|drive.?mode|drivingMode|driveMode|carMode|hands.?free|road.?mode/gi],
  ["voice-assistant", /SpeechRecognition|webkitSpeechRecognition|speechSynthesis|voice.?command|assistant.?mode|ai.?assistant|microphone|mic.?btn|voice.?input/gi],\n  ["driving-ui-css", /viora-driving|viora-expansion/gi]
];
const files=[];
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(e.isDirectory()){if(!ignored.has(e.name))walk(path.join(dir,e.name));}else if(exts.has(path.extname(e.name)))files.push(path.join(dir,e.name));}}
walk(root);
const findings=[];
for(const file of files){
 const lines=fs.readFileSync(file,"utf8").split(/\r?\n/); const hits=[];
 for(let i=0;i<lines.length;i++){const cats=[];for(const [name,re] of patterns){re.lastIndex=0;if(re.test(lines[i]))cats.push(name);}if(cats.length)hits.push({line:i+1,categories:cats});}
 if(!hits.length)continue;
 const ranges=[];
 for(const h of hits){const start=Math.max(1,h.line-28),end=Math.min(lines.length,h.line+34),last=ranges[ranges.length-1];if(last&&start<=last.end+2)last.end=Math.max(last.end,end);else ranges.push({start,end});}
 const excerpts=[];let used=0;
 for(const r of ranges){if(used>6000)break;excerpts.push(lines.slice(r.start-1,r.end).map((line,i)=>String(r.start+i).padStart(5," ")+": "+line).join("\n"));used+=r.end-r.start+1;}
 findings.push({path:path.relative(root,file).split(path.sep).join("/"),hits:hits.length,excerpts});
}
const report={schemaVersion:1,scannedFileCount:files.length,matchedFileCount:findings.length,categoryCounts:Object.fromEntries(patterns.map(([n])=>[n,findings.reduce((v,f)=>v+f.hits,0)])),files:findings};
fs.mkdirSync("artifacts",{recursive:true});
fs.writeFileSync("artifacts/viora-driving-mode-inspection.json",JSON.stringify(report,null,2)+"\n");
console.log("Driving-mode inspection: "+files.length+" source files scanned; "+findings.length+" files with driving/assistant matches.");
