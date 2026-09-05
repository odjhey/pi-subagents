import fs from "node:fs";
import path from "node:path";

const agentKeys = ["name", "description", "systemPrompt", "tools", "context", "model", "thinking", "cwd", "skills", "extensions"];
const thinking = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const defaultTools = ["read", "grep", "find", "ls"];

function object(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const unknown = Object.keys(value).filter(key => !keys.includes(key));
  if (unknown.length) throw new Error(`${label}: unknown fields: ${unknown.join(", ")}`);
}

function text(value, label) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.includes("\0") || value.includes("\r")) {
    throw new Error(`${label} must be non-empty trimmed text without NUL or carriage returns`);
  }
  return value;
}

function list(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  for (const item of value) {
    text(item, label);
    if (/[\n,]/.test(item)) throw new Error(`${label} items cannot contain commas or line breaks`);
  }
  if (new Set(value).size !== value.length) throw new Error(`${label} contains duplicates`);
  return value;
}

function validateAgent(spec) {
  object(spec, agentKeys, "agent");
  text(spec.name, "agent.name");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(spec.name)) throw new Error("agent.name must be an exact name using letters, digits, '.', '_', or '-'");
  text(spec.description, "agent.description");
  text(spec.systemPrompt, "agent.systemPrompt");
  for (const field of ["model", "thinking", "cwd"]) if (spec[field] !== undefined) text(spec[field], `agent.${field}`);
  if (spec.context !== undefined && !["fresh", "fork"].includes(spec.context)) throw new Error("agent.context must be fresh or fork");
  if (spec.thinking !== undefined && !thinking.includes(spec.thinking)) throw new Error("agent.thinking is not a supported Pi level");
  for (const field of ["tools", "skills", "extensions"]) if (spec[field] !== undefined) list(spec[field], `agent.${field}`);
  return { ...spec, tools: spec.tools ?? defaultTools, context: spec.context ?? "fresh" };
}

function scalar(key, value) {
  return `${key}: |-\n${value.split("\n").map(line => `  ${line}`).join("\n")}`;
}

function agentMarkdown(spec) {
  const lines = [`name: ${spec.name}`, scalar("description", spec.description), `context: ${spec.context}`];
  for (const field of ["model", "thinking", "cwd"]) if (spec[field] !== undefined) lines.push(scalar(field, spec[field]));
  for (const field of ["tools", "skills", "extensions"]) {
    if (spec[field] === undefined) continue;
    lines.push(`${field}:${spec[field].length ? "\n" + spec[field].map(item => `  - ${item}`).join("\n") : ""}`);
  }
  return `---\n${lines.join("\n")}\n---\n\n${spec.systemPrompt}\n`;
}

function validateSkill(skill) {
  object(skill, ["name", "description", "instructions"], "skill");
  text(skill.name, "skill.name");
  if (skill.name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name)) throw new Error("skill.name must use lowercase letters, digits, and single hyphens, up to 64 characters");
  text(skill.description, "skill.description");
  if (skill.description.length > 1024) throw new Error("skill.description must be at most 1024 characters");
  text(skill.instructions, "skill.instructions");
}

function presetFiles(spec) {
  object(spec, ["name", "description", "agents", "skill"], "preset");
  text(spec.name, "preset.name");
  if (spec.name.length > 214 || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(spec.name)) throw new Error("preset.name must be a lowercase npm package name");
  text(spec.description, "preset.description");
  if (!Array.isArray(spec.agents) || !spec.agents.length) throw new Error("preset.agents must contain at least one agent");
  const agents = spec.agents.map(validateAgent);
  if (new Set(agents.map(agent => agent.name)).size !== agents.length) throw new Error("preset has duplicate agent names");
  if (spec.skill !== undefined) validateSkill(spec.skill);
  const manifest = {
    name: spec.name, version: "0.1.0", description: spec.description, license: "UNLICENSED", type: "module",
    keywords: ["pi-package", "pi-subagents"],
    files: ["agents", ...(spec.skill ? ["skills"] : []), "README.md"],
    pi: spec.skill ? { skills: ["./skills"] } : {},
    "pi-subagents": { agents: ["./agents"] },
  };
  const files = new Map([["package.json", JSON.stringify(manifest, null, 2) + "\n"]]);
  for (const agent of agents) files.set(`agents/${agent.name}.md`, agentMarkdown(agent));
  if (spec.skill) files.set(`skills/${spec.skill.name}/SKILL.md`, `---\nname: ${spec.skill.name}\n${scalar("description", spec.skill.description)}\n---\n\n${spec.skill.instructions}\n`);
  const invocation = spec.skill
    ? `Invoke \`/skill:${spec.skill.name}\` with your task and constraints.`
    : `Ask the parent to launch an exact agent name with a complete task, for example:\n\n\`\`\`json\n${JSON.stringify({ agent: agents[0].name, task: "Describe the objective, relevant instructions, and expected result here." }, null, 2)}\n\`\`\``;
  files.set("README.md", `# ${spec.name}\n\n${spec.description}\n\n${agents.map(agent => `- \`${agent.name}\`: ${agent.description.replaceAll("\n", " ")}`).join("\n")}\n\n## Install and use\n\nRequires Pi 0.85.x and the odjhey/pi-subagents v1 fork. From your target project:\n\n\`\`\`bash\npi install -l git:github.com/odjhey/pi-subagents@v1.0.0\npi install -l /absolute/path/to/this-package\npi\n\`\`\`\n\nThe npm package named pi-subagents is upstream; use the fork's Git source above. Register this preset with Pi package settings so the kernel can discover its agents. Loading it only through -e is insufficient for agent discovery. This package has not been published automatically.\n\n${invocation}\n\nUse \`{ "action": "list" }\` to inspect agent names and diagnostics. Launch requests supply \`agent\` and \`task\` and omit \`action\`. The parent passes context between foreground calls and evaluates the reported evidence. A completed session may still report failed checks.\n\nThis scaffold starts with UNLICENSED metadata; set the package's license according to the author's intended distribution.\n`);
  return files;
}

function options(args) {
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!["--spec", "--out"].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith("--") || result[args[i]]) throw new Error("Expected --spec <json-file> --out <new-destination>");
    result[args[i]] = args[i + 1];
  }
  if (!result["--spec"] || !result["--out"]) throw new Error("Expected --spec <json-file> --out <new-destination>");
  return result;
}

try {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "--help") {
    console.log("Usage: node scaffold.mjs preset|agent --spec <json-file> --out <new-directory|new-file.md>");
  } else {
    if (!["preset", "agent"].includes(mode)) throw new Error("Choose preset or agent; use --help for usage");
    const opts = options(args);
    const spec = JSON.parse(fs.readFileSync(path.resolve(opts["--spec"]), "utf8"));
    const out = path.resolve(opts["--out"]);
    const files = mode === "preset" ? presetFiles(spec) : new Map([[path.basename(out), agentMarkdown(validateAgent(spec))]]);
    if (mode === "agent" && path.extname(out) !== ".md") throw new Error("Agent output must be a .md file");
    if (fs.existsSync(out) || (() => { try { fs.lstatSync(out); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } })()) throw new Error(`Destination already exists: ${out}`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    if (mode === "preset") fs.mkdirSync(out);
    for (const [relative, contents] of files) {
      const file = mode === "preset" ? path.join(out, relative) : out;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, contents, { flag: "wx" });
    }
    console.log(JSON.stringify({ created: out, files: mode === "preset" ? [...files.keys()] : [path.basename(out)] }));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
