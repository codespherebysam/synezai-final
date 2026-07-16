const assert = require("node:assert/strict");
const test = require("node:test");
const {
  generateReactProject,
  getOriginalProjectRequest,
  isCompleteReactProjectOutput,
  isGenerateProjectRequest,
} = require("../server");

const completeProject = `
=== FILE: package.json ===
\`\`\`json
{"name":"test-app","private":true,"version":"1.0.0","type":"module","scripts":{"dev":"vite","build":"vite build"},"dependencies":{"@vitejs/plugin-react":"5.0.2","vite":"7.1.3","react":"19.1.1","react-dom":"19.1.1"}}
\`\`\`
=== FILE: index.html ===
\`\`\`html
<div id="root"></div><script type="module" src="/src/main.jsx"></script>
\`\`\`
=== FILE: src/main.jsx ===
\`\`\`jsx
import { createRoot } from "react-dom/client"; import App from "./App"; import "./styles.css"; createRoot(document.getElementById("root")).render(<App />);
\`\`\`
=== FILE: src/App.jsx ===
\`\`\`jsx
import Header from "./components/Header"; import Main from "./components/Main"; import Footer from "./components/Footer"; export default function App(){return <><Header/><Main/><Footer/></>;}
\`\`\`
=== FILE: src/components/Header.jsx ===
\`\`\`jsx
export default function Header(){return <header>Header</header>;}
\`\`\`
=== FILE: src/components/Main.jsx ===
\`\`\`jsx
export default function Main(){return <main>Content</main>;}
\`\`\`
=== FILE: src/components/Footer.jsx ===
\`\`\`jsx
export default function Footer(){return <footer>Footer</footer>;}
\`\`\`
=== FILE: src/styles.css ===
\`\`\`css
body { margin: 0; }
\`\`\`
`;

test("routes direct React requests and preserves GENERATE context", () => {
  assert.equal(isGenerateProjectRequest("Build a React Vite dashboard app"), true);
  assert.equal(isGenerateProjectRequest("I need React code for a dashboard"), true);
  assert.equal(isGenerateProjectRequest("Create a vanilla landing page"), false);

  const original = getOriginalProjectRequest(
    [
      { role: "user", content: "Build a React Vite finance dashboard app" },
      { role: "assistant", content: "# Project Architecture" },
      { role: "user", content: "GENERATE" },
    ],
    "GENERATE"
  );

  assert.equal(original, "Build a React Vite finance dashboard app");
});

test("validates component-based React output", () => {
  assert.equal(isCompleteReactProjectOutput(completeProject), true);
  assert.equal(
    isCompleteReactProjectOutput("```html\n<div>Only HTML</div>\n```"),
    false
  );
});

test("generates React files using the original project request", async () => {
  const originalFetch = global.fetch;
  let providerPrompt = "";

  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    providerPrompt = body.messages.at(-1).content;
    return new Response(
      JSON.stringify({ choices: [{ message: { content: completeProject } }] }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const result = await generateReactProject({
      selectedModel: "llama-3.3-70b-versatile",
      userPrompt: "Build a React Vite finance dashboard app",
      userName: "Test User",
      userEmail: "test@example.com",
    });

    assert.equal(isCompleteReactProjectOutput(result.reply), true);
    assert.match(providerPrompt, /finance dashboard app/);
    assert.match(providerPrompt, /src\/components\//);
  } finally {
    global.fetch = originalFetch;
  }
});
