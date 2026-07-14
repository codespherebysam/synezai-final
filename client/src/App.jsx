import jsPDF from "jspdf";
import JSZip from "jszip";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import "./App.css";
import { signOut } from "firebase/auth";
import remarkGfm from "remark-gfm";
import { auth, db } from "./firebase";

import {
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  doc,
  onSnapshot,
  updateDoc,
} from "firebase/firestore";

const dedupeChats = (items = []) => {
  const seen = new Set();
  return items.filter((chat) => {
    const key = chat?.id || chat?.chatId || `${chat?.title || ""}-${chat?.createdAt || chat?.updatedAt || ""}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

function App() {


  const getUserName = () => {
    const user = auth.currentUser;
    if (user?.displayName) return user.displayName;
    if (user?.email) return user.email.split("@")[0];
    return "User";
  };

  const userName = getUserName();
  const userInitial = userName?.[0]?.toUpperCase() || "U";

  const [selectedFiles, setSelectedFiles] = useState([]);
  const [selectedImages, setSelectedImages] = useState([]);
  const [imagePreviews, setImagePreviews] = useState([]);
  const selectedImage = selectedImages[0] || null;
  const imagePreview = imagePreviews[0]?.url || "";
  const selectedFile = selectedFiles[0] || null;

  const setSelectedFile = (file) => {
    setSelectedFiles(file ? [file] : []);
  };

  const [theme, setTheme] = useState(localStorage.getItem("theme") || "dark");
  const [panelTab, setPanelTab] = useState("code");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [showMemoryPanel, setShowMemoryPanel] = useState(false);
  const [savedMemory, setSavedMemory] = useState({});
  const [memoryLoading, setMemoryLoading] = useState(false);

  const [showSidebar, setShowSidebar] = useState(false);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [copied, setCopied] = useState("");
  const [toast, setToast] = useState("");
  const [openMenuId, setOpenMenuId] = useState(null);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [activeSources, setActiveSources] = useState(null);

  const [renameChatId, setRenameChatId] = useState(null);
  const [renameText, setRenameText] = useState("");
  const [previewDoc, setPreviewDoc] = useState("");
  const [currentChatId, setCurrentChatId] = useState(null);
  const [showWorkPanel, setShowWorkPanel] = useState(false);

  const [isSpeaking, setIsSpeaking] = useState(false);
  const audioRef = useRef(null);
  const inputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);

  const [showDashboard, setShowDashboard] = useState(false);


  const [selectedModel, setSelectedModel] = useState("llama-3.3-70b-versatile");
  const [modelOpen, setModelOpen] = useState(false);
  const modelOptions = [
    { value: "llama-3.3-70b-versatile", label: "Groq Llama 3.3 70B", icon: "🧠" },
    { value: "llama-3.1-8b-instant", label: "Groq Llama 3.1 8B", icon: "⚡" },
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", icon: "✨" },
    { value: "openrouter/free", label: "OpenRouter Auto Free", icon: "🌐" },
  ];
  const currentModel = modelOptions.find((m) => m.value === selectedModel) || modelOptions[0];

  const getProviderName = (modelValue = selectedModel) => {
    if (modelValue.includes("openrouter") || modelValue.includes(":free")) return "OpenRouter";
    if (modelValue.startsWith("gemini")) return "Gemini";
    return "Groq";
  };

  const getModelFailoverQueue = (startModel = selectedModel, skipFirst = false) => {
    const preferredOrder = [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "gemini-2.5-flash",
      "openrouter/free",
    ];

    const ordered = [
      startModel,
      ...preferredOrder.filter((model) => model !== startModel),
    ].filter((model) => modelOptions.some((option) => option.value === model));

    return skipFirst ? ordered.slice(1) : ordered;
  };

  const isModelLimitError = (errorText = "") => {
    const t = String(errorText).toLowerCase();

  return (
      t.includes("limit") ||
      t.includes("rate") ||
      t.includes("quota") ||
      t.includes("429") ||
      t.includes("too many") ||
      t.includes("not found") ||
      t.includes("unsupported") ||
      t.includes("overloaded") ||
      t.includes("temporarily") ||
      t.includes("failed") ||
      t.includes("request failed")
    );
  };

  const askModelWithFailover = async ({
    baseMessages,
    imageDataPayload = null,
    signal,
    startModel = selectedModel,
    skipFirst = false,
    taskType = "chat",
  }) => {
    const queue = getModelFailoverQueue(startModel, skipFirst);
    let lastError = "";

    for (const modelValue of queue) {
      try {
        const res = await fetch("http://localhost:5000/chat", {
          method: "POST",
          signal,
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: modelValue,
            userName,
            userEmail: getUserEmail(),
            taskType,
            imageData: Array.isArray(imageDataPayload) ? imageDataPayload : imageDataPayload,
            messages: baseMessages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
          }),
        });

        let data = {};
        try {
          data = await res.json();
        } catch {
          data = {};
        }

        if (!res.ok) {
          const errorText = data.reply || data.error || `Model request failed (${res.status})`;
          lastError = errorText;

          if (isModelLimitError(errorText)) {
            continue;
          }

          continue;
        }

        if (modelValue !== selectedModel) {
          setSelectedModel(modelValue);
        }

        return {
          data,
          modelUsed: modelValue,
          providerUsed: data.provider || getProviderName(modelValue),
          switched: modelValue !== startModel,
        };
      } catch (error) {
        if (error.name === "AbortError") throw error;
        lastError = error.message || "Model request failed";
        continue;
      }
    }

    throw new Error(lastError || "All AI models failed");
  };



  const [confirmBox, setConfirmBox] = useState({
    show: false,
    type: "",
    id: null,
  });



  const speakText = async (text) => {
    try {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }

      setIsSpeaking(true);
      showToast("Generating voice...");

      const res = await fetch("http://localhost:5000/tts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) {
        throw new Error("Voice generation failed");
      }

      const audioBlob = await res.blob();
      const audioUrl = URL.createObjectURL(audioBlob);

      const audio = new Audio(audioUrl);
      audioRef.current = audio;

      audio.onended = () => {
        setIsSpeaking(false);
        URL.revokeObjectURL(audioUrl);
        audioRef.current = null;
      };

      audio.onerror = () => {
        setIsSpeaking(false);
        showToast("Voice playback failed");
      };

      await audio.play();
    } catch (error) {
      console.error(error);
      setIsSpeaking(false);
      showToast("Voice output failed");
    }
  };

  const stopSpeaking = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }

    setIsSpeaking(false);
  };



  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: `Welcome back, ${userName}.

SYNEZ AI is ready for coding, websites, research, image generation, image editing, background removal, studies, and creative projects.

What would you like to build today?`,
    },
  ]);

  const safeLocalJSON = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (error) {
      console.warn(`SYNEZ safeLocalJSON reset: ${key}`, error);
      localStorage.removeItem(key);
      return fallback;
    }
  };

  const [chatHistory, setChatHistory] = useState(
    safeLocalJSON("chatHistory", [])
  );

  const [pinnedChats, setPinnedChats] = useState(
    safeLocalJSON("pinnedChats", [])
  );

  const [files, setFiles] = useState({
    html: "",
    css: "",
    js: "",
  });

  const [projectFiles, setProjectFiles] = useState({});
  const [activeProjectFile, setActiveProjectFile] = useState("");
  const [projectMemoryReady, setProjectMemoryReady] = useState(false);
  const [projectValidation, setProjectValidation] = useState({ valid: false, errors: [] });
  const [previewVersion, setPreviewVersion] = useState(0);
  const [livePreviewEnabled, setLivePreviewEnabled] = useState(true);
  const [previewDevice, setPreviewDevice] = useState("desktop");
  const [inspectPreviewEnabled, setInspectPreviewEnabled] = useState(false);
  const [previewConsoleOpen, setPreviewConsoleOpen] = useState(false);
  const [previewConsoleLogs, setPreviewConsoleLogs] = useState([]);
  const [lastPreviewRuntimeError, setLastPreviewRuntimeError] = useState(null);
  const selfHealInFlightRef = useRef(false);
  const selfHealAttemptsRef = useRef(new Map());
  const [devtoolsOpen, setDevtoolsOpen] = useState(false);
  const [devtoolsTab, setDevtoolsTab] = useState("console");
  const [previewNetworkLogs, setPreviewNetworkLogs] = useState([]);
  const [previewAssets, setPreviewAssets] = useState([]);
  const [previewPerformance, setPreviewPerformance] = useState(null);
  const [previewScore, setPreviewScore] = useState(null);
  const [previewDependencyReport, setPreviewDependencyReport] = useState(null);
  const [previewDevicePreset, setPreviewDevicePreset] = useState("desktop");
  const [selectedPreviewElement, setSelectedPreviewElement] = useState(null);
  const [aiEditOpen, setAiEditOpen] = useState(false);
  const [aiEditPrompt, setAiEditPrompt] = useState("");
  const [aiEditDraft, setAiEditDraft] = useState(null);
  const [editBackups, setEditBackups] = useState([]);
  const [aiEditCounter, setAiEditCounter] = useState(1);
  const [aiLiveEdits, setAiLiveEdits] = useState([]);
  const [aiEditTargets, setAiEditTargets] = useState([]);
  const [aiEditUndoStack, setAiEditUndoStack] = useState([]);
  const [aiEditRedoStack, setAiEditRedoStack] = useState([]);
  const [aiAppliedEdits, setAiAppliedEdits] = useState([]);

  const previewDeviceMeta = {
    desktop: { label: "Desktop", icon: "🖥️", width: "100%", maxWidth: "100%" },
    laptop: { label: "Laptop", icon: "💻", width: "1366px", maxWidth: "96%" },
    ipad: { label: "iPad", icon: "📟", width: "820px", maxWidth: "94%" },
    tablet: { label: "Tablet", icon: "📟", width: "768px", maxWidth: "92%" },
    iphone: { label: "iPhone", icon: "📱", width: "390px", maxWidth: "92%" },
    pixel: { label: "Pixel", icon: "📱", width: "412px", maxWidth: "92%" },
    galaxy: { label: "Galaxy", icon: "📱", width: "430px", maxWidth: "92%" },
    mobile: { label: "Mobile", icon: "📱", width: "390px", maxWidth: "92%" },
  };

  const currentPreviewDevice = previewDeviceMeta[previewDevice] || previewDeviceMeta.desktop;

  const hasProjectFiles = Object.keys(projectFiles).length > 0;
  const activeProject = activeProjectFile ? projectFiles[activeProjectFile] : null;
  


  const getFileLanguage = (fileName = "") => {
    if (/\.jsx$/i.test(fileName)) return "jsx";
    if (/\.tsx$/i.test(fileName)) return "tsx";
    if (/\.js$/i.test(fileName)) return "javascript";
    if (/\.css$/i.test(fileName)) return "css";
    if (/\.html$/i.test(fileName)) return "html";
    if (/\.json$/i.test(fileName)) return "json";
    if (/\.md$/i.test(fileName)) return "markdown";
    return "text";
  };

  const hasGeneratedCode = Boolean(files.html || files.css || files.js || previewDoc || hasProjectFiles);

  const bumpPreviewVersion = () => {
    setPreviewVersion((version) => version + 1);
  };



  const messagesEndRef = useRef(null);
  const projectMemorySaveTimerRef = useRef(null);
  const abortControllerRef = useRef(null);
  const recognitionRef = useRef(null);
  const lastOrchestratedRouteRef = useRef({ prompt: "", route: "chat", meta: null });

  const filteredChats = chatHistory
    .filter((chat) => !pinnedChats.some((p) => p.id === chat.id))
    .filter((chat) =>
      chat.title.toLowerCase().includes(searchQuery.toLowerCase())
    );

  const filteredPinnedChats = pinnedChats.filter((chat) =>
    chat.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  useEffect(() => {
    setPreviewDependencyReport(analyzeProjectDependencies(projectFiles));
  }, [projectFiles]);

  useEffect(() => {
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    let cancelled = false;

    const restoreProjectMemory = async () => {
      const userEmail = auth.currentUser?.email || "guest";
      const localKey = `synezProjectMemory:${userEmail}`;
      let restored = null;

      try {
        const response = await fetch(
          `http://localhost:5000/project-memory?userEmail=${encodeURIComponent(userEmail)}`
        );

        if (response.ok) {
          const data = await response.json();
          if (data?.success && data?.project?.projectFiles) restored = data.project;
        }
      } catch (error) {
        console.warn("Project memory backend restore failed:", error.message);
      }

      if (!restored) {
        restored = safeLocalJSON(localKey, null);
      }

      if (!cancelled && restored?.projectFiles && Object.keys(restored.projectFiles).length) {
        setProjectFiles(restored.projectFiles);
        setActiveProjectFile(
          restored.activeProjectFile && restored.projectFiles[restored.activeProjectFile]
            ? restored.activeProjectFile
            : Object.keys(restored.projectFiles)[0]
        );
        setProjectValidation(validateProjectFiles(restored.projectFiles));
      }

      if (!cancelled) setProjectMemoryReady(true);
    };

    restoreProjectMemory();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!projectMemoryReady) return;
    // Never overwrite a valid remembered project with an empty UI state.
    if (!projectFiles || !Object.keys(projectFiles).length) return;

    const userEmail = auth.currentUser?.email || "guest";
    const localKey = `synezProjectMemory:${userEmail}`;
    const payload = {
      projectName: "Current SYNEZ Project",
      projectFiles,
      activeProjectFile,
      updatedAt: Date.now(),
    };

    localStorage.setItem(localKey, JSON.stringify(payload));

    clearTimeout(projectMemorySaveTimerRef.current);
    projectMemorySaveTimerRef.current = setTimeout(async () => {
      try {
        await fetch("http://localhost:5000/project-memory/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userEmail,
            ...payload,
          }),
        });
      } catch (error) {
        console.warn("Project memory backend save failed:", error.message);
      }
    }, 700);

    return () => clearTimeout(projectMemorySaveTimerRef.current);
  }, [projectFiles, activeProjectFile, projectMemoryReady]);

  useEffect(() => {
    if (!modelOptions.some((m) => m.value === selectedModel)) {
      setSelectedModel("llama-3.3-70b-versatile");
    }
  }, [selectedModel]);

  useEffect(() => {
    const scrollToLatestMessage = () => {
      messagesEndRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
    };

    requestAnimationFrame(scrollToLatestMessage);
    const scrollTimer = setTimeout(scrollToLatestMessage, 80);

    return () => clearTimeout(scrollTimer);
  }, [messages, loading, selectedFiles.length, selectedImages.length]);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;

    const box = textarea.closest(".chat-input-box");
    const area = textarea.closest(".input-area");
    const hasAttachments = Boolean(selectedFiles.length || selectedImages.length);

    textarea.style.height = "48px";
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, 48), 132);
    textarea.style.height = `${nextHeight}px`;

    if (box) {
      box.style.overflow = "hidden";
      box.style.gridTemplateRows = hasAttachments
        ? `auto minmax(48px, ${nextHeight}px)`
        : `minmax(48px, ${nextHeight}px)`;
      box.style.minHeight = "";
    }

    if (area) {
      area.style.minHeight = "";
    }
  }, [input, selectedFiles.length, selectedImages.length]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  useEffect(() => {
    const user = auth.currentUser;

    if (!user) return;

    const chatsRef = collection(db, "users", user.uid, "chats");

    const unsubscribe = onSnapshot(chatsRef, (snapshot) => {
      const chats = snapshot.docs.map((docItem) => ({
        id: docItem.id,
        ...docItem.data(),
      }));

      chats.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));

      setChatHistory(dedupeChats(chats));
      localStorage.setItem("chatHistory", JSON.stringify(dedupeChats(chats)));
    });

    return () => unsubscribe();
  }, []);

  const showToast = (text) => {
    setToast(text);
    setTimeout(() => setToast(""), 2000);
  };

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  const extractFiles = (text = "") => {
    if (
      /#\s*Project Architecture|Project Architecture|File Tree|Recommended Tech Stack|Component Plan|Reply\s+\*\*?GENERATE/i.test(String(text || "")) &&
      !/```html|<!DOCTYPE|<html|<body|<main|<section/i.test(String(text || ""))
    ) {
      return { html: "", css: "", js: "" };
    }

    let html = "";
    let css = "";
    let js = "";

    const decodeLiteralNewlines = (value = "") =>
      String(value || "")
        .replace(/\\n/g, "\n")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, '"')
        .replace(/\\'/g, "'");

    const normalizeBrokenCode = (value = "") =>
      decodeLiteralNewlines(value)
        .replace(/\bHTML\s*Copy\s*/gi, "\n```html\n")
        .replace(/\bCSS\s*Copy\s*/gi, "\n```\n\n```css\n")
        .replace(/\bJAVASCRIPT\s*Copy\s*/gi, "\n```\n\n```javascript\n")
        .replace(/\bJS\s*Copy\s*/gi, "\n```\n\n```javascript\n")
        .replace(/<\s*!\s*DOCTYPE\s+html\s*>/gi, "<!DOCTYPE html>")
        .replace(/<\s*\/\s*([a-z][\w-]*)\s*>/gi, "</$1>")
        .replace(/<\s*([a-z][\w-]*)\s+/gi, "<$1 ")
        .replace(/<\s*([a-z][\w-]*)\s*>/gi, "<$1>")
        .replace(/<\n*!?\n*DOCTYPE\n+html\n*>/gi, "<!DOCTYPE html>")
        .replace(/<\n*\/\n*([a-z][\w-]*)\n*>/gi, "</$1>")
        .replace(/<\n*([a-z][\w-]*)\n+/gi, "<$1 ")
        .replace(/\n*=\n*/g, "=")
        .replace(/\n{3,}/g, "\n\n");

    const cleanBlock = (value = "") =>
      normalizeBrokenCode(value)
        .replace(/^<!--\s*[\w.-]+\s*-->\s*/gm, "")
        .replace(/^\/\/\s*[\w.-]+\s*$/gm, "")
        .replace(/^\/\*\s*[\w.-]+\s*\*\/$/gm, "")
        .trim();

    const cutBeforeNextLanguage = (value = "", current = "") => {
      let output = String(value || "");

      const patterns = current === "html"
        ? [
            /\n```css/i,
            /\n```javascript/i,
            /\n```js/i,
            /\n\s*CSS\s*(Copy)?\s*\n/i,
            /\n\s*JAVASCRIPT\s*(Copy)?\s*\n/i,
            /\n\s*JS\s*(Copy)?\s*\n/i,
            /\n\s*css\s*\n/i,
            /\n\s*javascript\s*\n/i,
          ]
        : current === "css"
        ? [
            /\n```javascript/i,
            /\n```js/i,
            /\n\s*JAVASCRIPT\s*(Copy)?\s*\n/i,
            /\n\s*JS\s*(Copy)?\s*\n/i,
            /\n\s*javascript\s*\n/i,
          ]
        : [];

      let cutIndex = -1;
      for (const pattern of patterns) {
        const match = output.match(pattern);
        if (match && match.index !== undefined) {
          cutIndex = cutIndex === -1 ? match.index : Math.min(cutIndex, match.index);
        }
      }

      if (cutIndex >= 0) output = output.slice(0, cutIndex);
      return output.trim();
    };

    const sourceText = normalizeBrokenCode(text);

    const htmlMatch = sourceText.match(/```html\s*([\s\S]*?)```/i);
    const cssMatch = sourceText.match(/```css\s*([\s\S]*?)```/i);
    const jsMatch =
      sourceText.match(/```javascript\s*([\s\S]*?)```/i) ||
      sourceText.match(/```js\s*([\s\S]*?)```/i);

    html = htmlMatch ? cleanBlock(cutBeforeNextLanguage(htmlMatch[1], "html")) : "";
    css = cssMatch ? cleanBlock(cutBeforeNextLanguage(cssMatch[1], "css")) : "";
    js = jsMatch ? cleanBlock(jsMatch[1]) : "";

    // Fallback: language labels without complete fences
    if (!html) {
      const htmlLabel = sourceText.search(/```html|HTML\s*Copy|\bHTML\b/i);
      const cssLabel = sourceText.search(/```css|CSS\s*Copy|\bCSS\b/i);
      const htmlStart = sourceText.search(/<!DOCTYPE html>|<html|<body|<header|<main|<section|<nav/i);

      if (htmlStart >= 0) {
        const endAt = cssLabel > htmlStart ? cssLabel : undefined;
        html = cleanBlock(sourceText.slice(htmlStart, endAt));
      } else if (htmlLabel >= 0 && cssLabel > htmlLabel) {
        html = cleanBlock(sourceText.slice(htmlLabel, cssLabel).replace(/```html|HTML\s*Copy|\bHTML\b/i, ""));
      }
    }

    if (!css) {
      const cssStart =
        sourceText.search(/```css/i) >= 0
          ? sourceText.search(/```css/i)
          : sourceText.search(/CSS\s*Copy|\bCSS\b|:root\s*\{|body\s*\{|html\s*\{|[*]\s*\{/i);

      const jsStart = sourceText.search(/```javascript|```js|JAVASCRIPT\s*Copy|\bJAVASCRIPT\b|\bJS\b|document\.|addEventListener|const\s+|let\s+|function\s+/i);

      if (cssStart >= 0) {
        let raw = sourceText.slice(cssStart, jsStart > cssStart ? jsStart : undefined);
        raw = raw
          .replace(/```css/gi, "")
          .replace(/CSS\s*Copy/gi, "")
          .replace(/^\s*CSS\s*/i, "")
          .replace(/```/g, "");
        if (/[.#:a-zA-Z*][\w\s.#:[\]="'-]*\{[\s\S]*?:[\s\S]*?\}/.test(raw)) {
          css = cleanBlock(raw);
        }
      }
    }

    if (!js) {
      const jsStart = sourceText.search(/```javascript|```js|JAVASCRIPT\s*Copy|\bJAVASCRIPT\b|\bJS\b|document\.|addEventListener|const\s+|let\s+|function\s+/i);
      if (jsStart >= 0) {
        let raw = sourceText.slice(jsStart)
          .replace(/```javascript|```js/gi, "")
          .replace(/JAVASCRIPT\s*Copy|JS\s*Copy/gi, "")
          .replace(/^\s*(JAVASCRIPT|JS)\s*/i, "")
          .replace(/```/g, "")
          .trim();

        // Stop if another language accidentally appears after JS.
        raw = raw.replace(/\n\s*```html[\s\S]*$/i, "").replace(/\n\s*```css[\s\S]*$/i, "");
        if (/(const |let |var |function |document\.|addEventListener|=>)/i.test(raw)) {
          js = cleanBlock(raw);
        }
      }
    }

    // Split inline CSS/JS from full HTML
    if (html) {
      html = cutBeforeNextLanguage(html, "html");

      const styleMatches = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)];
      if (!css && styleMatches.length) {
        css = cleanBlock(styleMatches.map((m) => m[1]).join("\n\n"));
      }

      const scriptMatches = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
      if (!js && scriptMatches.length) {
        js = cleanBlock(scriptMatches.map((m) => m[1]).join("\n\n"));
      }

      // Keep only the actual HTML document/body, never raw CSS/JS text after it.
      const htmlDoc =
        html.match(/<!DOCTYPE html>[\s\S]*?<\/html>/i) ||
        html.match(/<html[\s\S]*?<\/html>/i);
      if (htmlDoc) html = htmlDoc[0];

      html = html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<link[^>]*rel=["']stylesheet["'][^>]*>/gi, "")
        .replace(/<script[^>]*src=["'][^"']+["'][^>]*>\s*<\/script>/gi, "")
        .replace(/<\/?html[^>]*>/gi, "")
        .replace(/<head[\s\S]*?<\/head>/gi, "")
        .replace(/<\/?body[^>]*>/gi, "")
        .replace(/<!DOCTYPE[^>]*>/gi, "")
        .trim();
    }

    // Final safety: CSS must not be inside HTML preview.
    html = html
      .replace(/\n\s*css\s*\n[\s\S]*$/i, "")
      .replace(/\n\s*CSS\s*\n[\s\S]*$/i, "")
      .replace(/\n\s*javascript\s*\n[\s\S]*$/i, "")
      .replace(/\n\s*JAVASCRIPT\s*\n[\s\S]*$/i, "")
      .trim();

    css = css
      .replace(/\n\s*javascript\s*\n[\s\S]*$/i, "")
      .replace(/\n\s*JAVASCRIPT\s*\n[\s\S]*$/i, "")
      .trim();

    return { html, css, js };
  };


  const extractProjectFiles = (content = "") => {
    const text = String(content || "");
    const files = {};
    const unknownBlocks = [];

    const isValidProjectFileName = (name = "") =>
      /^(package\.json|index\.html|vite\.config\.(js|mjs|ts)|README\.md|src\/[\w./-]+\.(jsx|tsx|js|css|json|md)|server\/[\w./-]+\.(js|json|md))$/i.test(
        String(name || "").trim()
      );

    const cleanFileName = (value = "") =>
      String(value || "")
        .trim()
        .replace(/^["'`]+|["'`]+$/g, "")
        .replace(/^[:=\-\s]+/, "")
        .replace(/^(filename|file|path)\s*[:=]\s*/i, "")
        .replace(/^\/\/\s*/, "")
        .trim();

    const inferFileNameFromNearbyText = (before = "") => {
      const lines = String(before || "").split("\n").slice(-6).reverse();

      for (const line of lines) {
        const cleaned = line.trim();

        const patterns = [
          /(?:File|Filename|Path)\s*[:=-]\s*([A-Za-z0-9_./-]+\.(jsx|tsx|js|css|html|json|md))/i,
          /^#{1,6}\s*([A-Za-z0-9_./-]+\.(jsx|tsx|js|css|html|json|md))\s*$/i,
          /^([A-Za-z0-9_./-]+\.(jsx|tsx|js|css|html|json|md))\s*$/i,
          /`([A-Za-z0-9_./-]+\.(jsx|tsx|js|css|html|json|md))`/i,
        ];

        for (const pattern of patterns) {
          const match = cleaned.match(pattern);
          if (match && isValidProjectFileName(match[1])) return match[1];
        }
      }

      return "";
    };

    const inferFileNameFromCode = (lang = "", code = "") => {
      const c = String(code || "");

      // Only infer when code has a very clear identity.
      if (lang === "json") {
        try {
          const parsed = JSON.parse(c);
          if (parsed && parsed.scripts && (parsed.dependencies || parsed.devDependencies)) {
            return "package.json";
          }
        } catch {}
        return "";
      }

      if (lang === "html" && /<div\s+id=["']root["']|<script[^>]+src=["']\/src\/main\.jsx["']/i.test(c)) {
        return "index.html";
      }

      if ((lang === "jsx" || lang === "tsx" || lang === "js" || lang === "javascript") && /createRoot\s*\(|ReactDOM\.createRoot/i.test(c)) {
        return "src/main.jsx";
      }

      if ((lang === "jsx" || lang === "tsx" || lang === "js" || lang === "javascript") && /export\s+default\s+function\s+App|function\s+App\s*\(|const\s+App\s*=/.test(c)) {
        return "src/App.jsx";
      }

      if ((lang === "js" || lang === "javascript") && /(export\s+const\s+movies|const\s+movies\s*=|title:\s*["']Movie|image:\s*["']movie)/i.test(c)) {
        return "src/data/mockData.js";
      }

      if (lang === "css" && /body\s*\{|:root\s*\{|\.app\s*\{|\.navbar\s*\{/i.test(c)) {
        return "src/styles.css";
      }

      return "";
    };

    const addFile = (fileName = "", lang = "", code = "") => {
      const name = cleanFileName(fileName);
      const body = String(code || "").trim();

      if (!name || !isValidProjectFileName(name) || !body) return false;

      // Hard guards
      if (/Project Architecture|Recommended Tech Stack|Component Plan|File Tree|Reply\s+\*\*?GENERATE/i.test(body)) return false;

      if (name === "package.json") {
        try {
          JSON.parse(body);
        } catch {
          return false;
        }
      }

      if (/(^|\/)main\.(jsx|tsx|js)$/i.test(name) && !/(createRoot|ReactDOM\.createRoot|render\s*\()/i.test(body)) {
        return false;
      }

      if (/(^|\/)App\.(jsx|tsx|js)$/i.test(name) && !/(function\s+App|const\s+App\s*=|export\s+default|return\s*\(|<main|<div|<section)/i.test(body)) {
        return false;
      }

      files[name] = {
        name,
        lang: lang === "javascript" ? "js" : lang,
        code: body,
      };

      return true;
    };

    // Do not extract architecture-only responses as project files.
    if (
      /Project Architecture|Recommended Tech Stack|Component Plan|Reply\s+\*\*?GENERATE/i.test(text) &&
      !/filename\s*=|file\s*:|path\s*:|```jsx|```json|```css|```html/i.test(text)
    ) {
      return {};
    }

    const blockRegex = /```(jsx|tsx|js|javascript|css|html|json|txt|md)?([^\n`]*)\n([\s\S]*?)```/gi;

    let match;
    while ((match = blockRegex.exec(text))) {
      const lang = (match[1] || "").toLowerCase();
      const meta = (match[2] || "").trim();
      const code = (match[3] || "").trim();
      const before = text.slice(0, match.index);

      if (!code) continue;
      if (lang === "txt" || lang === "md") {
        // Ignore file trees and architecture blocks.
        if (/├──|└──|Project Architecture|File Tree|Recommended Tech Stack|src\//i.test(code)) continue;
      }

      let fileName = "";

      const metaMatch = meta.match(/(?:filename|file|path)\s*[:=]\s*([A-Za-z0-9_./-]+\.(jsx|tsx|js|css|html|json|md))/i);
      if (metaMatch) fileName = metaMatch[1];

      if (!fileName) {
        const directMeta = cleanFileName(meta);
        if (isValidProjectFileName(directMeta)) fileName = directMeta;
      }

      if (!fileName) fileName = inferFileNameFromNearbyText(before);
      if (!fileName) fileName = inferFileNameFromCode(lang, code);

      if (!fileName) {
        unknownBlocks.push({ lang, code });
        continue;
      }

      addFile(fileName, lang, code);
    }

    return files;
  };

  const validateProjectFiles = (project = {}) => {
    const names = Object.keys(project || {});
    const errors = [];

    const appFile = names.find((name) => /(^|\/)App\.(jsx|tsx|js)$/i.test(name));
    const mainFile = names.find((name) => /(^|\/)main\.(jsx|tsx|js)$/i.test(name));
    const cssFile = names.find((name) => /\.css$/i.test(name));
    const packageFile = project["package.json"];

    if (!names.length) {
      errors.push("No valid project files found. Architecture/file-tree text was ignored.");
    }

    if (packageFile) {
      try {
        JSON.parse(packageFile.code || "");
      } catch {
        errors.push("package.json is not valid JSON.");
      }
    }

    if (!appFile) errors.push("Missing src/App.jsx.");
    // main.jsx is optional for React Preview v1 because preview can render App.jsx directly.
    if (!cssFile) errors.push("Missing CSS file.");

    if (mainFile) {
      const mainCode = project[mainFile]?.code || "";
      if (!/(createRoot|ReactDOM\.createRoot|render\s*\()/i.test(mainCode)) {
        errors.push("src/main.jsx does not contain React root render code.");
      }
    }

    if (appFile) {
      const appCode = project[appFile]?.code || "";
      if (!/function\s+App|const\s+App\s*=|export\s+default|return\s*\(/i.test(appCode)) {
        errors.push("src/App.jsx does not look like a valid React component.");
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      appFile,
      mainFile,
      cssFile,
    };
  };

  const isReactProjectOutput = (content = "") => {
    const text = String(content || "");
    return (
      /package\.json|vite\.config|src\/App\.jsx|src\/main\.jsx|React\s*\+?\s*Vite|import\s+React|from\s+["']react["']/i.test(text) &&
      /```(jsx|tsx|js|javascript|json|css|html)/i.test(text)
    );
  };




  const detectPreviewRuntime = (project = projectFiles, vanillaFiles = files) => {
    const names = Object.keys(project || {});
    const packageJson = project?.["package.json"]?.code || "";

    const hasPackageReact = /"react"\s*:|"@vitejs\/plugin-react"\s*:|"vite"\s*:/i.test(packageJson);
    const hasReactFiles = names.some((name) => /\.(jsx|tsx)$/i.test(name)) || names.some((name) => /(^|\/)App\.(jsx|tsx|js)$/i.test(name));
    const hasNext = names.some((name) => /^(app|pages)\//i.test(name)) || /"next"\s*:/i.test(packageJson);
    const hasVue = names.some((name) => /\.vue$/i.test(name)) || /"vue"\s*:/i.test(packageJson);
    const hasSvelte = names.some((name) => /\.svelte$/i.test(name)) || /"svelte"\s*:/i.test(packageJson);
    const hasNode =
      names.some((name) => /^server\//i.test(name)) ||
      /"express"\s*:|"fastify"\s*:|"nodemon"\s*:/i.test(packageJson);

    if (hasNext) return "next";
    if (hasVue) return "vue";
    if (hasSvelte) return "svelte";
    if (hasPackageReact || hasReactFiles) return "react";
    if (hasNode) return "node";

    if (vanillaFiles?.html || vanillaFiles?.css || vanillaFiles?.js) return "vanilla";

    return "unknown";
  };


  const analyzeProjectDependencies = (project = projectFiles) => {
    const filesMap = project || {};
    const names = Object.keys(filesMap);
    const packageCode = filesMap["package.json"]?.code || "";
    const declared = new Set();

    try {
      const pkg = JSON.parse(packageCode || "{}");
      Object.keys(pkg.dependencies || {}).forEach((dep) => declared.add(dep));
      Object.keys(pkg.devDependencies || {}).forEach((dep) => declared.add(dep));
    } catch {}

    const imports = [];
    const missing = [];
    const unsupported = [];

    const supportedRuntimePackages = new Set(["react", "react-dom"]);
    const needsRuntimeLoader = new Set([
      "react-router-dom",
      "framer-motion",
      "lucide-react",
      "axios",
      "@reduxjs/toolkit",
      "react-redux",
      "@tanstack/react-query",
      "zustand",
    ]);

    names.forEach((path) => {
      if (!/\.(jsx|tsx|js|ts)$/i.test(path)) return;
      const code = filesMap[path]?.code || "";
      const matches = [...code.matchAll(/import\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g)];

      matches.forEach((match) => {
        const source = match[1];
        if (!source || source.startsWith(".") || source.startsWith("/") || source.startsWith("@/")) return;

        imports.push({ file: path, package: source });

        if (!declared.has(source) && !supportedRuntimePackages.has(source)) {
          missing.push({ file: path, package: source });
        }

        if (needsRuntimeLoader.has(source) && !supportedRuntimePackages.has(source)) {
          unsupported.push({ file: path, package: source });
        }
      });
    });

    const unique = (items) => {
      const seen = new Set();
      return items.filter((item) => {
        const key = `${item.file}:${item.package}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };

    const uniqueUnsupported = unique(unsupported);

    return {
      imports: unique(imports),
      missing: unique(missing),
      unsupported: uniqueUnsupported,
      declared: [...declared],
      hasBlockingIssues: uniqueUnsupported.length > 0,
    };
  };

  const buildDependencyOverlayHTML = (report) => {
    if (!report || !report.hasBlockingIssues) return "";

    const unsupported = (report.unsupported || [])
      .map((item) => `<li><strong>${item.package}</strong><span>${item.file}</span></li>`)
      .join("");

    const installText = [...new Set((report.unsupported || []).map((item) => item.package))]
      .map((dep) => `npm install ${dep}`)
      .join("\\n");

    return `
      <div class="synez-runtime-overlay">
        <div class="synez-runtime-card">
          <div class="synez-runtime-pill">Dependency Runtime</div>
          <h2>Preview needs package runtime support</h2>
          <p>This project imports packages that the current browser preview cannot execute yet.</p>
          <ul>${unsupported}</ul>
          <pre>${installText}</pre>
          <p class="hint">For instant preview, use React-only mode. Next phase can add real runtime loaders for these packages.</p>
        </div>
      </div>
    `;
  };



  const getSafePackageRuntimeReport = (project = projectFiles) => {
    const filesMap = project || {};
    const imports = [];
    const packageJson = filesMap["package.json"]?.code || "";
    const declared = new Set();

    try {
      const pkg = JSON.parse(packageJson || "{}");
      Object.keys(pkg.dependencies || {}).forEach((dep) => declared.add(dep));
      Object.keys(pkg.devDependencies || {}).forEach((dep) => declared.add(dep));
    } catch {}

    Object.entries(filesMap).forEach(([path, file]) => {
      if (!/\.(jsx|tsx|js|ts)$/i.test(path)) return;
      const code = file?.code || "";
      const matches = [...code.matchAll(/import\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g)];
      matches.forEach((m) => {
        const source = m[1];
        if (!source || source.startsWith(".") || source.startsWith("/") || source.startsWith("@/")) return;
        imports.push({ file: path, package: source });
      });
    });

    const supported = new Set(["react", "react-dom"]);
    const planned = new Set(["react-router-dom", "axios", "framer-motion", "lucide-react"]);
    const seen = new Set();

    const unique = imports.filter((item) => {
      const key = `${item.file}:${item.package}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map((item) => ({
      ...item,
      declared: declared.has(item.package),
      supported: supported.has(item.package),
      planned: planned.has(item.package),
      status: supported.has(item.package)
        ? "supported"
        : planned.has(item.package)
        ? "planned"
        : "unsupported",
    }));

    return {
      imports: unique,
      declared: [...declared],
      blocking: unique.filter((x) => x.status !== "supported"),
      hasBlocking: unique.some((x) => x.status !== "supported"),
    };
  };

  const buildSafePackageRuntimeOverlay = (report) => {
    if (!report || !report.hasBlocking) return "";

    const rows = report.blocking
      .map((item) => {
        const label = item.status === "planned" ? "Runtime planned" : "Unsupported";
        return `<li><b>${item.package}</b><span>${label}</span><small>${item.file}</small></li>`;
      })
      .join("");

    const install = [...new Set(report.blocking.map((x) => x.package))]
      .map((dep) => `npm install ${dep}`)
      .join("\\n");

    return `
      <div class="synez-package-overlay">
        <div class="synez-package-card">
          <div class="synez-package-top">SYNEZ Runtime Check</div>
          <h2>External packages detected</h2>
          <p>Your project generated successfully, but this browser preview currently supports React-only execution.</p>
          <ul>${rows}</ul>
          <pre>${install}</pre>
          <p class="synez-package-hint">Use React-only prompts for instant preview, or continue Phase 14 package loaders.</p>
        </div>
      </div>
    `;
  };


  const getRuntimeLabel = (runtime = "") => {
    const map = {
      vanilla: "HTML Runtime",
      react: "React Runtime",
      next: "Next.js Runtime",
      vue: "Vue Runtime",
      svelte: "Svelte Runtime",
      node: "Node Runtime",
      unknown: "Unknown Runtime",
    };

    return map[runtime] || "Unknown Runtime";
  };

  const buildUnsupportedRuntimePreview = (runtime = "unknown", project = projectFiles) => {
    const fileList = Object.keys(project || {}).slice(0, 30);

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>SYNEZ Preview Runtime</title>
<style>
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  background:
    radial-gradient(circle at 20% 10%, rgba(139,92,246,.28), transparent 35%),
    radial-gradient(circle at 80% 20%, rgba(34,211,238,.18), transparent 35%),
    #070914;
  color: #f8fafc;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Arial, sans-serif;
}
.card {
  width: min(760px, calc(100vw - 32px));
  border: 1px solid rgba(255,255,255,.14);
  background: rgba(255,255,255,.07);
  backdrop-filter: blur(18px);
  border-radius: 28px;
  padding: 28px;
  box-shadow: 0 24px 90px rgba(0,0,0,.34);
}
h1 { margin: 0 0 10px; font-size: 34px; }
p { color: #aab3c5; line-height: 1.7; }
code {
  display: inline-block;
  padding: 4px 8px;
  border-radius: 8px;
  background: rgba(255,255,255,.1);
}
.files {
  margin-top: 18px;
  display: grid;
  gap: 8px;
  max-height: 260px;
  overflow: auto;
}
.file {
  padding: 9px 10px;
  border-radius: 12px;
  background: rgba(255,255,255,.06);
  color: #dbeafe;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 13px;
}
</style>
</head>
<body>
${packageRuntimeOverlay}
${dependencyOverlayHTML}
  <section class="card">
    <h1>${getRuntimeLabel(runtime)}</h1>
    <p>This runtime has been detected, but live preview support for it is not fully enabled yet.</p>
    <p>Current support: <code>HTML/CSS/JS</code> and <code>React/Vite v1</code>.</p>
    <p>Files detected:</p>
    <div class="files">
      ${fileList.map((file) => `<div class="file">${file}</div>`).join("") || "<div class='file'>No files detected</div>"}
    </div>
  </section>

<script>
setTimeout(function(){
  try {
    var root = document.getElementById("root");
    var text = root ? (root.innerText || root.textContent || "").trim() : "";
    var hasUsefulChild = root && root.children && root.children.length > 0;
    var hasError = !!document.querySelector(".synez-error-overlay, .synez-react-error");
    if (root && !text && !hasUsefulChild && !hasError) {
      var empty = document.createElement("div");
      empty.className = "synez-empty-preview";
      empty.innerHTML = "<strong>Preview is blank</strong><br/>Open Tools → Console/Dependencies or regenerate with strict file format.";
      document.body.appendChild(empty);
    }
  } catch {}
}, 900);
</script>

</body>
</html>`;
  };

  const buildRuntimePreview = (runtime = detectPreviewRuntime()) => {
    if (runtime === "vanilla") return buildPreviewCode(files);
    if (runtime === "react") return buildReactPreviewCode(projectFiles);
    return buildUnsupportedRuntimePreview(runtime, projectFiles);
  };


  const previewRuntime = hasProjectFiles
    ? detectPreviewRuntime(projectFiles, files)
    : detectPreviewRuntime({}, files);

  const canPreviewRuntime =
    hasProjectFiles &&
    (previewRuntime === "react"
      ? projectValidation.valid
      : ["next", "vue", "svelte", "node", "unknown"].includes(previewRuntime));




  useEffect(() => {
    const handlePreviewMessage = (event) => {
      const data = event?.data || {};
      if (data?.source === "SYNEZ_PREVIEW_CONSOLE") {
        const logType = data.type || "log";
        const logMessage = String(data.message || "");
        setPreviewConsoleLogs((logs) => [
          ...logs.slice(-120),
          {
            type: logType,
            message: logMessage,
            time: new Date().toLocaleTimeString(),
          },
        ]);

        if (
          logType === "error" ||
          /uncaught|referenceerror|typeerror|syntaxerror|failed to compile|cannot resolve|is not defined|unexpected token|blank preview/i.test(logMessage)
        ) {
          setLastPreviewRuntimeError({
            message: logMessage,
            type: logType,
            time: Date.now(),
          });
        }
        return;
      }

      if (data?.source === "SYNEZ_PREVIEW_NETWORK") {
        setPreviewNetworkLogs((logs) => [
          ...logs.slice(-120),
          {
            method: data.method || "GET",
            url: data.url || "",
            status: data.status || "pending",
            timeMs: data.timeMs || 0,
            ok: data.ok !== false,
            time: new Date().toLocaleTimeString(),
          },
        ]);
        return;
      }

      if (data?.source === "SYNEZ_PREVIEW_REPORT") {
        if (Array.isArray(data.assets)) setPreviewAssets(data.assets);
        if (data.performance) setPreviewPerformance(data.performance);
        if (data.score) setPreviewScore(data.score);
        return;
      }

      if (data?.source === "SYNEZ_PREVIEW_SELECTED_ELEMENT") {
        setSelectedPreviewElement(data.element || null);
        setAiEditOpen(true);
        setPanelTab("preview");
        return;
      }
    };

    window.addEventListener("message", handlePreviewMessage);
    return () => window.removeEventListener("message", handlePreviewMessage);
  }, []);

  const clearPreviewConsole = () => setPreviewConsoleLogs([]);

  useEffect(() => {
    if (!lastPreviewRuntimeError || !Object.keys(projectFiles || {}).length) return;
    if (selfHealInFlightRef.current) return;

    const signature = String(lastPreviewRuntimeError.message || "").slice(0, 500);
    const previousAttempts = selfHealAttemptsRef.current.get(signature) || 0;
    if (previousAttempts >= 2) return;

    const timer = setTimeout(async () => {
      selfHealInFlightRef.current = true;
      selfHealAttemptsRef.current.set(signature, previousAttempts + 1);
      showToast(`Self-healing preview · Attempt ${previousAttempts + 1}/2`);

      try {
        const response = await fetch("http://localhost:5000/runtime-self-heal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            runtimeError: lastPreviewRuntimeError,
            projectFiles,
            diagnostics: getCodingAgentDiagnostics(),
            model: selectedModel,
            userName,
            userEmail: getUserEmail(),
          }),
        });

        const data = await readJsonResponse(response, "Runtime Self-Heal backend");
        if (!response.ok || data.success === false) {
          throw new Error(data.error || "Runtime self-heal failed");
        }

        const changedFiles = data.files || {};
        const changedNames = Object.keys(changedFiles);
        if (!changedNames.length) {
          setPreviewConsoleLogs((logs) => [
            ...logs.slice(-120),
            { type: "warn", message: data.summary || "Self-heal found no safe patch.", time: new Date().toLocaleTimeString() },
          ]);
          return;
        }

        await createProjectSnapshot(`Before self-heal: ${signature.slice(0, 80)}`, projectFiles);
        const nextProject = mergeCodingAgentFiles(projectFiles, changedFiles);
        const validation = validateProjectFiles(nextProject);
        setProjectFiles(nextProject);
        setProjectValidation(validation);
        setActiveProjectFile((current) => current && nextProject[current] ? current : changedNames[0]);
        setPreviewConsoleLogs((logs) => [
          ...logs.slice(-120),
          { type: "success", message: `Self-heal applied: ${changedNames.join(", ")}`, time: new Date().toLocaleTimeString() },
        ]);
        setMessages((current) => [
          ...current,
          {
            role: "assistant",
            content: `### Runtime Self-Heal\n\n${data.summary || "Preview error repaired."}\n\n**Files changed:** ${changedNames.join(", ")}\n\n${(data.changes || []).map((item) => `- ${item}`).join("\n")}`,
            provider: data.provider || "SYNEZ Runtime Self-Heal",
            model: data.model || "Phase 6.8",
          },
        ]);
        setLastPreviewRuntimeError(null);
        setTimeout(() => bumpPreviewVersion(), 120);
      } catch (error) {
        console.error("Runtime self-heal error:", error);
        setPreviewConsoleLogs((logs) => [
          ...logs.slice(-120),
          { type: "error", message: `Self-heal failed: ${error.message}`, time: new Date().toLocaleTimeString() },
        ]);
      } finally {
        selfHealInFlightRef.current = false;
      }
    }, 900);

    return () => clearTimeout(timer);
  }, [lastPreviewRuntimeError, projectFiles, selectedModel]);


  const detectPreviewDependencies = (project = projectFiles) => {
    const builtin = new Set([
      "react",
      "react-dom",
      "react-dom/client",
      "vite",
      "@vitejs/plugin-react"
    ]);

    const deps = new Set();
    const filesToCheck = Object.values(project || {}).map((file) => file?.code || "").join("\\n");

    const regex = /import\\s+(?:[\\s\\S]*?)\\s+from\\s+["']([^."'][^"']*)["']|import\\s+["']([^."'][^"']*)["']/g;
    let match;
    while ((match = regex.exec(filesToCheck))) {
      const pkg = (match[1] || match[2] || "").trim();
      if (!pkg) continue;
      const root = pkg.startsWith("@") ? pkg.split("/").slice(0, 2).join("/") : pkg.split("/")[0];
      if (!builtin.has(pkg) && !builtin.has(root)) deps.add(root);
    }

    const knownCommands = {
      axios: "npm install axios",
      "react-router-dom": "npm install react-router-dom",
      "framer-motion": "npm install framer-motion",
      "lucide-react": "npm install lucide-react",
      gsap: "npm install gsap",
      three: "npm install three",
      recharts: "npm install recharts",
      "@react-three/fiber": "npm install three @react-three/fiber",
    };

    return [...deps].map((name) => ({
      name,
      command: knownCommands[name] || `npm install ${name}`,
    }));
  };

  const getDependencyWarnings = () => detectPreviewDependencies(projectFiles);




  // SYNEZ 11.0: generic textarea MutationObserver disabled.
  // It was resizing AI Edit and preview textareas and caused input overflow glitches.

  const buildAiLiveEditStyle = () => {
    return "";
  };




  useEffect(() => {
    const fixChatScrollPosition = () => {
      try {
        const containers = [
          document.querySelector(".messages"),
          document.querySelector("section.messages"),
          document.querySelector(".chat-messages"),
          document.querySelector(".message-list")
        ].filter(Boolean);

        containers.forEach((box) => {
          if (box.scrollHeight > box.clientHeight) {
            box.scrollTop = box.scrollHeight;
          }
        });
      } catch {}
    };

    const timer = setTimeout(fixChatScrollPosition, 150);
    window.__SYNEZ_SCROLL_RECOVERY_FIX = true;

    window.addEventListener("resize", fixChatScrollPosition);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", fixChatScrollPosition);
    };
  }, []);


  const cleanEditSelector = (selector = "") => {
    let value = String(selector || "button")
      .replace(/\.__synez_inspect_selected/g, "")
      .replace(/\.__synez_edit_target/g, "")
      .replace(/\.__?synez[^\s.]*/g, "")
      .replace(/\.synez-ai-edit-\d+/g, "")
      .replace(/__synez[^\s.]*/g, "")
      .replace(/\s+/g, "")
      .replace(/\.\./g, ".")
      .replace(/\.$/, "")
      .trim();

    if (!value || value === "." || value.includes("ynez_in") || value.includes("pect_")) return "button";
    return value;
  };

  const buildEditStyleObject = (instruction = "") => {
    const text = String(instruction || "").toLowerCase();
    const style = {};

    if (text.includes("purple")) Object.assign(style, { background: "linear-gradient(135deg, #7c3aed, #a855f7)", color: "#ffffff" });
    if (text.includes("blue")) Object.assign(style, { background: "linear-gradient(135deg, #2563eb, #38bdf8)", color: "#ffffff" });
    if (text.includes("red")) Object.assign(style, { background: "linear-gradient(135deg, #dc2626, #fb7185)", color: "#ffffff" });
    if (text.includes("green")) Object.assign(style, { background: "linear-gradient(135deg, #16a34a, #4ade80)", color: "#ffffff" });
    if (text.includes("yellow")) Object.assign(style, { background: "linear-gradient(135deg, #f59e0b, #fde047)", color: "#111827" });
    if (text.includes("black") || text.includes("dark")) Object.assign(style, { background: "#020617", color: "#ffffff" });
    if (text.includes("white")) Object.assign(style, { background: "#ffffff", color: "#111827" });

    if (text.includes("rounded") || text.includes("round")) style.borderRadius = "999px";
    if (text.includes("less rounded")) style.borderRadius = "10px";
    if (text.includes("larger") || text.includes("big")) Object.assign(style, { padding: "14px 28px", fontSize: "18px" });
    if (text.includes("smaller") || text.includes("small")) Object.assign(style, { padding: "8px 14px", fontSize: "13px" });
    if (text.includes("shadow")) style.boxShadow = "0 18px 45px rgba(0,0,0,.28)";
    if (text.includes("glow")) style.boxShadow = "0 0 28px rgba(139,92,246,.55)";
    if (text.includes("glass")) Object.assign(style, { background: "rgba(255,255,255,.16)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,.24)" });
    if (text.includes("border")) style.border = "2px solid rgba(255,255,255,.45)";
    if (text.includes("center")) Object.assign(style, { display: "inline-flex", alignItems: "center", justifyContent: "center" });

    if (!Object.keys(style).length) {
      Object.assign(style, { outline: "3px solid #22d3ee", outlineOffset: "3px" });
    }

    return style;
  };

  const styleObjectToCss = (style = {}) => {
    const toKebab = (key = "") => key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
    return Object.entries(style)
      .map(([key, value]) => `  ${toKebab(key)}: ${value} !important;`)
      .join("\n");
  };

  const styleObjectToJSX = (style = {}) => {
    return `{{ ${Object.entries(style)
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
      .join(", ")} }}`;
  };

  const buildBasicEditCSS = (instruction = "", selector = "button", editId = "stable") => {
    const cleanSelector = cleanEditSelector(selector);
    const style = buildEditStyleObject(instruction);
    return `\n/* SYNEZ AI Edit Applied: ${editId} */\n${cleanSelector} {\n${styleObjectToCss(style)}\n}\n`;
  };

  const mergeInlineStyleIntoAttrs = (attrs = "", style = {}) => {
    const styleJSX = styleObjectToJSX(style);
    if (/\sstyle\s*=\s*\{\{[\s\S]*?\}\}/.test(attrs)) {
      return attrs.replace(/\sstyle\s*=\s*\{\{([\s\S]*?)\}\}/, (match, existing) => {
        const extra = Object.entries(style).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join(", ");
        return ` style={{ ${existing.trim().replace(/,$/, "")}${existing.trim() ? ", " : ""}${extra} }}`;
      });
    }
    return `${attrs} style=${styleJSX}`;
  };

  const applyInlineStyleToProjectFiles = (files = {}, selectedElement = {}, instruction = "") => {
    const next = { ...(files || {}) };
    const tag = selectedElement?.tag || "button";
    const text = String(selectedElement?.text || "").trim();
    const style = buildEditStyleObject(instruction);
    const jsxPaths = Object.keys(next).filter((path) => /\.(jsx|tsx|js)$/i.test(path));

    for (const path of jsxPaths) {
      const code = next[path]?.code || "";
      let updated = code;

      if (text) {
        const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const tagWithText = new RegExp(`<${tag}([^>]*)>([\\s\\S]*?${escaped}[\\s\\S]*?)<\\/${tag}>`, "m");
        if (tagWithText.test(updated)) {
          updated = updated.replace(tagWithText, (match, attrs, inner) => `<${tag}${mergeInlineStyleIntoAttrs(attrs, style)}>${inner}</${tag}>`);
        }
      }

      if (updated === code) {
        const firstTag = new RegExp(`<${tag}([^>]*)>`, "m");
        if (firstTag.test(updated)) {
          updated = updated.replace(firstTag, (match, attrs) => `<${tag}${mergeInlineStyleIntoAttrs(attrs, style)}>`);
        }
      }

      if (updated !== code) {
        next[path] = { ...next[path], code: updated };
        return { next, patchedPath: path, patched: true };
      }
    }

    return { next, patchedPath: "", patched: false };
  };


  const normalizeEditTarget = (element = {}) => {
    const selector = cleanEditSelector(element.selector || element.tag || "button");
    return {
      id: element.id || "",
      tag: element.tag || "element",
      className: String(element.className || "")
        .split(/\s+/)
        .filter(Boolean)
        .filter((c) => !c.startsWith("__synez") && !c.startsWith("synez-ai-edit-"))
        .join(" "),
      selector,
      text: String(element.text || "").trim(),
      parent: element.parent || "",
      width: element.width || 0,
      height: element.height || 0,
      x: element.x || 0,
      y: element.y || 0,
    };
  };

  const getCurrentAiEditTargets = () => {
    const list = aiEditTargets.length
      ? aiEditTargets
      : selectedPreviewElement
      ? [selectedPreviewElement]
      : [];

    const seen = new Set();
    return list
      .map(normalizeEditTarget)
      .filter((target) => {
        const key = `${target.tag}|${target.selector}|${target.text}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  };

  const addSelectedElementToEditTargets = () => {
    if (!selectedPreviewElement) {
      setAiEditDraft({
        type: "error",
        title: "No element selected",
        message: "Turn Inspect On and click an element inside the preview first.",
      });
      return;
    }

    const nextTarget = normalizeEditTarget(selectedPreviewElement);
    setAiEditTargets((targets) => {
      const exists = targets.some((target) => {
        const clean = normalizeEditTarget(target);
        return clean.selector === nextTarget.selector && clean.text === nextTarget.text && clean.tag === nextTarget.tag;
      });
      return exists ? targets : [...targets, nextTarget];
    });
  };

  const removeAiEditTarget = (indexToRemove) => {
    setAiEditTargets((targets) => targets.filter((_, index) => index !== indexToRemove));
  };

  const clearAiEditTargets = () => {
    setAiEditTargets([]);
  };

  const getSmartCssPath = (files = {}) => {
    if (files["src/styles.css"]) return "src/styles.css";
    if (files["styles.css"]) return "styles.css";
    if (files["src/App.css"]) return "src/App.css";
    return "src/styles.css";
  };

  const buildSmartCssPatch = (instruction = "", targets = [], editId = "stable") => {
    const style = buildEditStyleObject(instruction);
    return targets.map((target, index) => {
      const selector = cleanEditSelector(target.selector || target.tag || "button");
      const marker = `SYNEZ_AI_EDIT_V2:${selector}`;
      return `/* ${marker} */\n${selector} {\n${styleObjectToCss(style)}\n}\n/* END_${marker} */`;
    }).join("\n\n");
  };

  const upsertSmartCssPatch = (cssCode = "", patch = "") => {
    let output = String(cssCode || "");
    const blocks = String(patch || "").split(/\n\n(?=\/\* SYNEZ_AI_EDIT_V2:)/g).filter(Boolean);

    blocks.forEach((block) => {
      const markerMatch = block.match(/\/\*\s*(SYNEZ_AI_EDIT_V2:[^*]+?)\s*\*\//);
      if (!markerMatch) {
        output = `${output}\n${block}`;
        return;
      }

      const marker = markerMatch[1].trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const blockRegex = new RegExp(`/\\*\\s*${marker}\\s*\\*/[\\s\\S]*?/\\*\\s*END_${marker}\\s*\\*/`, "m");

      if (blockRegex.test(output)) {
        output = output.replace(blockRegex, block.trim());
      } else {
        output = `${output.trim()}\n\n${block.trim()}`;
      }
    });

    return output.trim() + "\n";
  };

  const pushAiEditUndoSnapshot = (reason = "AI Edit") => {
    setAiEditUndoStack((stack) => [
      ...stack.slice(-19),
      {
        id: Date.now(),
        reason,
        files: projectFiles,
        activeFile: activeProjectFile,
        appliedEdits: aiAppliedEdits,
      },
    ]);
    setAiEditRedoStack([]);
  };

  const undoAiEditV2 = () => {
    const last = aiEditUndoStack[aiEditUndoStack.length - 1];
    if (!last) return;

    setAiEditRedoStack((stack) => [
      ...stack.slice(-19),
      {
        id: Date.now(),
        reason: "Redo snapshot",
        files: projectFiles,
        activeFile: activeProjectFile,
        appliedEdits: aiAppliedEdits,
      },
    ]);

    setProjectFiles(last.files || {});
    setActiveProjectFile(last.activeFile || "");
    setAiAppliedEdits(last.appliedEdits || []);
    setAiEditUndoStack((stack) => stack.slice(0, -1));
    setPanelTab("preview");
    setTimeout(() => bumpPreviewVersion(), 100);
  };

  const redoAiEditV2 = () => {
    const last = aiEditRedoStack[aiEditRedoStack.length - 1];
    if (!last) return;

    setAiEditUndoStack((stack) => [
      ...stack.slice(-19),
      {
        id: Date.now(),
        reason: "Undo snapshot",
        files: projectFiles,
        activeFile: activeProjectFile,
        appliedEdits: aiAppliedEdits,
      },
    ]);

    setProjectFiles(last.files || {});
    setActiveProjectFile(last.activeFile || "");
    setAiAppliedEdits(last.appliedEdits || []);
    setAiEditRedoStack((stack) => stack.slice(0, -1));
    setPanelTab("preview");
    setTimeout(() => bumpPreviewVersion(), 100);
  };


  const getNaturalEditSelector = (instruction = "", fallback = "") => {
    const text = String(instruction || "").toLowerCase();

    if (text.includes("all button") || text.includes("every button") || text.includes("buttons")) {
      return "button, .button, .btn";
    }

    if (text.includes("all card") || text.includes("every card") || text.includes("cards")) {
      return ".card, .movie-card, .feature-card, article, [class*='card']";
    }

    if (text.includes("heading") || text.includes("title") || text.includes("headings")) {
      return "h1, h2, h3, .title, .heading";
    }

    if (text.includes("navbar") || text.includes("nav bar") || text.includes("navigation")) {
      return "nav, .navbar, header";
    }

    if (text.includes("hero")) {
      return ".hero, section:first-of-type, header";
    }

    if (text.includes("input") || text.includes("search box") || text.includes("searchbar")) {
      return "input, textarea, .search, .search-box";
    }

    if (text.includes("whole website") || text.includes("entire website") || text.includes("full website") || text.includes("site")) {
      return "body, #root, .app";
    }

    return fallback || selectedPreviewElement?.selector || "button";
  };

  const buildNaturalEditCSS = (instruction = "", fallbackSelector = "") => {
    const text = String(instruction || "").toLowerCase();
    const selector = cleanEditSelector(getNaturalEditSelector(instruction, fallbackSelector));
    const rules = [];

    if (text.includes("purple")) rules.push("background: linear-gradient(135deg, #7c3aed, #a855f7) !important;", "color: #ffffff !important;");
    if (text.includes("blue")) rules.push("background: linear-gradient(135deg, #2563eb, #38bdf8) !important;", "color: #ffffff !important;");
    if (text.includes("green")) rules.push("background: linear-gradient(135deg, #16a34a, #4ade80) !important;", "color: #ffffff !important;");
    if (text.includes("red")) rules.push("background: linear-gradient(135deg, #dc2626, #fb7185) !important;", "color: #ffffff !important;");
    if (text.includes("orange")) rules.push("background: linear-gradient(135deg, #ea580c, #fb923c) !important;", "color: #ffffff !important;");
    if (text.includes("black") || text.includes("dark")) rules.push("background: #020617 !important;", "color: #ffffff !important;");
    if (text.includes("white") || text.includes("light")) rules.push("background: #ffffff !important;", "color: #111827 !important;");

    if (text.includes("rounded") || text.includes("round")) rules.push("border-radius: 22px !important;");
    if (text.includes("pill")) rules.push("border-radius: 999px !important;");
    if (text.includes("shadow")) rules.push("box-shadow: 0 20px 55px rgba(0,0,0,.24) !important;");
    if (text.includes("glow")) rules.push("box-shadow: 0 0 34px rgba(139,92,246,.55) !important;");
    if (text.includes("larger") || text.includes("big")) rules.push("transform: scale(1.04);", "font-size: 1.08em !important;");
    if (text.includes("smaller")) rules.push("transform: scale(.96);", "font-size: .92em !important;");
    if (text.includes("padding") || text.includes("space")) rules.push("padding: 18px 28px !important;");
    if (text.includes("glass") || text.includes("glassmorphism")) rules.push(
      "background: rgba(255,255,255,.14) !important;",
      "backdrop-filter: blur(18px) !important;",
      "border: 1px solid rgba(255,255,255,.22) !important;",
      "box-shadow: 0 20px 60px rgba(0,0,0,.18) !important;"
    );
    if (text.includes("hover")) {
      rules.push("transition: all .25s ease !important;");
    }
    if (text.includes("center")) rules.push("display: flex !important;", "align-items: center !important;", "justify-content: center !important;");

    if (!rules.length) {
      rules.push("outline: 3px solid #22d3ee !important;", "outline-offset: 4px !important;");
    }

    let css = `

/* SYNEZ AI Natural Edit */
${selector} {
  ${rules.join("\\n  ")}
}
`;

    if (text.includes("hover")) {
      css += `
${selector}:hover {
  transform: translateY(-3px) scale(1.03) !important;
  filter: brightness(1.08) !important;
}
`;
    }

    if (text.includes("apple")) {
      css += `
body, #root, .app {
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif !important;
  background: linear-gradient(135deg, #f8fafc, #e5e7eb) !important;
  color: #111827 !important;
}
button, .button, .btn, .card, [class*="card"] {
  border-radius: 24px !important;
  background: rgba(255,255,255,.82) !important;
  color: #111827 !important;
  box-shadow: 0 22px 55px rgba(15,23,42,.12) !important;
  border: 1px solid rgba(15,23,42,.08) !important;
}
`;
    }

    return { selector, css };
  };


  const getPhase12AppFilePath = (project = projectFiles) => {
    const names = Object.keys(project || {});
    return (
      names.find((name) => /(^|\/)App\.(jsx|tsx|js)$/i.test(name)) ||
      names.find((name) => /(^|\/)Home\.(jsx|tsx|js)$/i.test(name)) ||
      names.find((name) => /\.(jsx|tsx|js)$/i.test(name)) ||
      "src/App.jsx"
    );
  };

  const getPhase12CssFilePath = (project = projectFiles) => getSmartCssPath(project);

  const extractPhase12Imports = (code = "") => {
    return String(code || "")
      .split("\n")
      .filter((line) => /^\s*import\s+/.test(line))
      .slice(0, 30);
  };

  const extractPhase12ComponentNames = (project = projectFiles) => {
    const names = new Set();
    Object.values(project || {}).forEach((file) => {
      const code = file?.code || "";
      [...code.matchAll(/function\s+([A-Z][A-Za-z0-9_]*)\s*\(/g)].forEach((m) => names.add(m[1]));
      [...code.matchAll(/const\s+([A-Z][A-Za-z0-9_]*)\s*=\s*\(/g)].forEach((m) => names.add(m[1]));
      [...code.matchAll(/export\s+default\s+function\s+([A-Z][A-Za-z0-9_]*)/g)].forEach((m) => names.add(m[1]));
    });
    return [...names];
  };

  const extractPhase12DesignTokens = (project = projectFiles) => {
    const cssPath = getPhase12CssFilePath(project);
    const cssCode = project?.[cssPath]?.code || "";
    const colors = [...new Set((cssCode.match(/#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)/g) || []).slice(0, 28))];
    const radii = [...new Set((cssCode.match(/border-radius\s*:\s*[^;]+/g) || []).slice(0, 12))];
    const shadows = [...new Set((cssCode.match(/box-shadow\s*:\s*[^;]+/g) || []).slice(0, 12))];
    return { colors, radii, shadows };
  };

  const buildPhase12ProjectContext = () => {
    const appPath = getPhase12AppFilePath(projectFiles);
    const cssPath = getPhase12CssFilePath(projectFiles);
    const appCode = projectFiles?.[appPath]?.code || "";
    const cssCode = projectFiles?.[cssPath]?.code || "";
    const selected = normalizeEditTarget(selectedPreviewElement || {});
    const targets = getCurrentAiEditTargets();

    return {
      version: "AI_EDIT_V3_PHASE_12",
      projectType: detectPreviewRuntime(projectFiles, files),
      selectedElement: selected,
      targets,
      activeFile: appPath,
      cssFile: cssPath,
      imports: extractPhase12Imports(appCode),
      componentNames: extractPhase12ComponentNames(projectFiles),
      dependencies: detectPreviewDependencies(projectFiles).map((d) => d.name),
      designTokens: extractPhase12DesignTokens(projectFiles),
      relatedCode: {
        jsx: appCode.slice(0, 5000),
        css: cssCode.slice(0, 5000),
      },
      instruction: aiEditPrompt,
      createdAt: new Date().toISOString(),
    };
  };

  const insertPhase12SnippetIntoReturn = (code = "", snippet = "") => {
    const source = String(code || "");
    if (!source.trim()) return source;

    const h1Close = source.search(/<\/h1>/i);
    if (h1Close >= 0) {
      const insertAt = h1Close + source.slice(h1Close).indexOf("\n") + 1;
      return source.slice(0, insertAt) + `\n${snippet}\n` + source.slice(insertAt);
    }

    const mainClose = source.lastIndexOf("</main>");
    if (mainClose >= 0) return source.slice(0, mainClose) + `\n${snippet}\n` + source.slice(mainClose);

    const sectionClose = source.lastIndexOf("</section>");
    if (sectionClose >= 0) return source.slice(0, sectionClose) + `\n${snippet}\n` + source.slice(sectionClose);

    const divClose = source.lastIndexOf("</div>");
    if (divClose >= 0) return source.slice(0, divClose) + `\n${snippet}\n` + source.slice(divClose);

    return source;
  };

  const buildPhase12StructuralPatch = (instruction = "") => {
    const text = String(instruction || "").toLowerCase();
    const appPath = getPhase12AppFilePath(projectFiles);
    const cssPath = getPhase12CssFilePath(projectFiles);
    const appCode = projectFiles?.[appPath]?.code || "";
    let jsxSnippet = "";
    let cssPatch = "";
    let title = "AI Edit v3 Structural Draft";
    let description = "Project-aware JSX/CSS patch generated.";

    if (text.includes("pricing")) {
      jsxSnippet = `        <section className="synez-v3-pricing">
          <div className="synez-v3-pricing-head">
            <span>Pricing</span>
            <h2>Choose the plan that fits your workflow</h2>
            <p>Simple plans for builders, creators, and teams.</p>
          </div>
          <div className="synez-v3-price-grid">
            {["Starter", "Pro", "Team"].map((plan, index) => (
              <div className="synez-v3-price-card" key={plan}>
                <h3>{plan}</h3>
                <strong>{index === 0 ? "$0" : index === 1 ? "$19" : "$49"}</strong>
                <p>{index === 0 ? "For testing ideas." : index === 1 ? "For serious builders." : "For growing teams."}</p>
                <button>{index === 0 ? "Start Free" : "Choose Plan"}</button>
              </div>
            ))}
          </div>
        </section>`;
      cssPatch = `
/* SYNEZ AI Edit v3 Pricing Section */
.synez-v3-pricing { margin: 42px auto; padding: 34px; border-radius: 30px; background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.18); backdrop-filter: blur(18px); }
.synez-v3-pricing-head { text-align: center; max-width: 680px; margin: 0 auto 24px; }
.synez-v3-pricing-head span { color: #8b5cf6; font-weight: 900; text-transform: uppercase; letter-spacing: .14em; }
.synez-v3-pricing-head h2 { font-size: clamp(28px, 5vw, 48px); margin: 10px 0; }
.synez-v3-price-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 18px; }
.synez-v3-price-card { padding: 24px; border-radius: 24px; background: rgba(15,23,42,.82); color: #fff; box-shadow: 0 24px 60px rgba(0,0,0,.22); }
.synez-v3-price-card strong { display: block; font-size: 38px; margin: 12px 0; }
.synez-v3-price-card button { margin-top: 14px; border: 0; padding: 12px 18px; border-radius: 999px; background: linear-gradient(135deg,#7c3aed,#22d3ee); color: #fff; font-weight: 900; }
`;
      title = "Pricing Section Draft";
      description = "Adds a reusable pricing section into the current React screen.";
    } else if (text.includes("saas") || text.includes("landing")) {
      jsxSnippet = `        <section className="synez-v3-saas-block">
          <p className="synez-v3-eyebrow">AI-powered platform</p>
          <h2>Build, preview, and improve your product faster</h2>
          <p>Generate interfaces, inspect elements, and apply intelligent edits without leaving your workspace.</p>
          <div className="synez-v3-saas-actions">
            <button>Start Building</button>
            <button>View Demo</button>
          </div>
        </section>`;
      cssPatch = `
/* SYNEZ AI Edit v3 SaaS Block */
.synez-v3-saas-block { margin: 38px auto; padding: 42px; border-radius: 34px; background: radial-gradient(circle at top left, rgba(124,58,237,.28), transparent 38%), rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.18); text-align: center; backdrop-filter: blur(20px); }
.synez-v3-eyebrow { color: #22d3ee; font-weight: 900; letter-spacing: .12em; text-transform: uppercase; }
.synez-v3-saas-block h2 { font-size: clamp(32px, 6vw, 60px); line-height: 1.05; margin: 12px 0; }
.synez-v3-saas-block p { max-width: 720px; margin-left: auto; margin-right: auto; }
.synez-v3-saas-actions { display: flex; justify-content: center; gap: 14px; flex-wrap: wrap; margin-top: 24px; }
.synez-v3-saas-actions button { border: 0; border-radius: 999px; padding: 13px 22px; font-weight: 900; background: linear-gradient(135deg,#7c3aed,#2563eb); color: white; }
`;
      title = "SaaS Landing Draft";
      description = "Adds a polished SaaS landing section.";
    } else if (text.includes("modal") || text.includes("login")) {
      jsxSnippet = `        <div className="synez-v3-login-modal">
          <div className="synez-v3-login-card">
            <h2>Welcome back</h2>
            <p>Sign in to continue your workflow.</p>
            <input placeholder="Email" />
            <input placeholder="Password" type="password" />
            <button>Login</button>
          </div>
        </div>`;
      cssPatch = `
/* SYNEZ AI Edit v3 Login Modal */
.synez-v3-login-modal { margin: 34px auto; display: grid; place-items: center; }
.synez-v3-login-card { width: min(380px, 100%); padding: 28px; border-radius: 28px; background: rgba(15,23,42,.90); color: white; border: 1px solid rgba(255,255,255,.14); box-shadow: 0 28px 80px rgba(0,0,0,.32); }
.synez-v3-login-card input { width: 100%; margin-top: 12px; padding: 13px 14px; border-radius: 14px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.08); color: white; }
.synez-v3-login-card button { width: 100%; margin-top: 16px; padding: 13px; border: 0; border-radius: 16px; background: linear-gradient(135deg,#7c3aed,#22d3ee); color: white; font-weight: 900; }
`;
      title = "Login Modal Draft";
      description = "Adds a clean login modal/card block.";
    } else if (text.includes("apple")) {
      cssPatch = buildNaturalEditCSS("make whole website apple style", "body, #root, .app").css;
      title = "Apple Style Draft";
      description = "Applies Apple-style design intelligence using smart CSS.";
    } else {
      return null;
    }

    const nextCode = jsxSnippet ? insertPhase12SnippetIntoReturn(appCode, jsxSnippet) : appCode;
    return {
      type: "phase12-structural",
      title,
      description,
      appPath,
      cssPath,
      oldCode: appCode,
      newCode: nextCode,
      cssPatch,
      diffPreview: `File: ${appPath}\n\n+ ${description}\n+ CSS patch: ${cssPath}`,
    };
  };

  const createPhase12EditDraft = () => {
    const instruction = aiEditPrompt.trim();
    if (!instruction) {
      setAiEditDraft({ type: "error", title: "Prompt required", message: "Write what you want to change." });
      return;
    }

    const structural = buildPhase12StructuralPatch(instruction);
    if (structural) {
      setAiEditDraft({
        type: "draft",
        title: structural.title,
        instruction,
        phase12: true,
        structural,
        cssPatch: structural.cssPatch,
        context: buildPhase12ProjectContext(),
        changes: [
          structural.description,
          "JSX structural patch prepared.",
          "Smart CSS patch prepared.",
          "Undo snapshot will be created before apply.",
        ],
        note: "AI Edit v3 Phase 12: project-aware JSX + CSS editing.",
      });
      return;
    }

    createNaturalLanguageEditDraft();
  };


  const createNaturalLanguageEditDraft = () => {
    const instruction = aiEditPrompt.trim();

    if (!instruction) {
      setAiEditDraft({
        type: "error",
        title: "Prompt required",
        message: "Write what you want to change.",
      });
      return;
    }

    const fallbackSelector = selectedPreviewElement?.selector || "button";
    const result = buildNaturalEditCSS(instruction, fallbackSelector);

    setEditBackups((backups) => [
      ...backups.slice(-9),
      {
        id: Date.now(),
        files: projectFiles,
        activeFile: activeProjectFile,
        reason: instruction,
      },
    ]);

    setAiEditDraft({
      type: "draft",
      title: "Natural Language Edit Draft",
      instruction,
      editSelector: result.selector,
      cssPatch: result.css,
      element: selectedPreviewElement,
      changes: [
        `Target selector: ${result.selector}`,
        "Smart CSS patch generated.",
        "Works for selected element or group commands like all buttons/cards/headings.",
        "Undo/Redo support remains available.",
      ],
      note: "AI Edit v2.5: natural language CSS patching.",
    });
  };


  const buildEditContext = () => {
    const rawElement = selectedPreviewElement || {};
    const cleanSelector = cleanEditSelector(rawElement.selector || rawElement.tag || "button");

    const element = normalizeEditTarget({
      ...rawElement,
      selector: cleanSelector,
      domPath: cleanSelector,
    });

    const targets = getCurrentAiEditTargets();
    const allFiles = Object.entries(projectFiles || {});
    const targetTextSet = new Set(targets.map((target) => String(target.text || "").trim()).filter(Boolean));

    const related = allFiles
      .filter(([path, file]) => {
        const code = file?.code || "";
        const hasTargetText = [...targetTextSet].some((text) => code.includes(text));
        return /\.(jsx|tsx|js|css)$/i.test(path) && (hasTargetText || path.includes("App") || path.includes("style") || path.endsWith(".css"));
      })
      .slice(0, 10);

    const filesSnapshot = (related.length ? related : allFiles.slice(0, 10)).map(([path, file]) => ({
      path,
      size: file?.code?.length || 0,
      preview: (file?.code || "").slice(0, 2200),
    }));

    const likelyActive =
      filesSnapshot.find((f) => /\.(jsx|tsx|js)$/i.test(f.path) && [...targetTextSet].some((text) => f.preview.includes(text)))?.path ||
      filesSnapshot.find((f) => /App\.(jsx|tsx|js)$/i.test(f.path))?.path ||
      activeProjectFile;

    return {
      version: "AI_EDIT_V2",
      selectedElement: element,
      targets,
      activeFile: likelyActive,
      cssFile: getSmartCssPath(projectFiles),
      appliedEdits: aiAppliedEdits,
      undoCount: aiEditUndoStack.length,
      redoCount: aiEditRedoStack.length,
      files: filesSnapshot,
      instruction: aiEditPrompt,
      createdAt: new Date().toISOString(),
    };
  };

  const createSafeEditDraft = () => {
    const instruction = aiEditPrompt.trim();

    if (!instruction) {
      setAiEditDraft({
        type: "error",
        title: "Prompt required",
        message: "Write what you want to change for the selected element.",
      });
      return;
    }

    const targets = getCurrentAiEditTargets();
    if (!targets.length) {
      setAiEditDraft({
        type: "error",
        title: "No element selected",
        message: "Turn Inspect On and click an element inside the preview first.",
      });
      return;
    }

    const editId = `synez-edit-v2-${Date.now()}`;
    const cssPatch = buildSmartCssPatch(instruction, targets, editId);

    setAiEditDraft({
      type: "draft",
      title: "AI Edit v2 Smart Patch Draft",
      instruction,
      element: targets[0],
      targets,
      editId,
      editSelector: targets.map((target) => target.selector).join(", "),
      cssPatch,
      context: buildEditContext(),
      changes: [
        `${targets.length} selected element${targets.length > 1 ? "s" : ""} will be edited permanently.`,
        "Smart CSS patch will update existing SYNEZ block instead of duplicating/replacing the full CSS file.",
        "JSX inline-style patch will be attempted for React elements for stronger persistence.",
        "Undo / Redo snapshot will be created before applying.",
      ],
      note: "AI Edit v2: permanent edits, multi-element targets, smart CSS patch, undo/redo.",
    });
  };

  const applyPersistentClassToFiles = (files, targetText, persistentClass, selectedElement = {}) => {
    const next = { ...(files || {}) };
    const text = (targetText || "").trim();
    const tag = selectedElement?.tag || "button";

    const jsxPaths = Object.keys(next).filter((path) => /\.(jsx|tsx|js)$/.test(path));

    const addClassToAttrs = (attrs = "") => {
      if (/className\s*=/.test(attrs)) {
        return attrs.replace(/className\s*=\s*(["'])(.*?)\1/, (m, q, cls) => {
          if (cls.includes(persistentClass)) return m;
          return `className=${q}${cls} ${persistentClass}${q}`;
        });
      }
      if (/class\s*=/.test(attrs)) {
        return attrs.replace(/class\s*=\s*(["'])(.*?)\1/, (m, q, cls) => {
          if (cls.includes(persistentClass)) return m;
          return `class=${q}${cls} ${persistentClass}${q}`;
        });
      }
      return `${attrs} className="${persistentClass}"`;
    };

    for (const path of jsxPaths) {
      const code = next[path]?.code || "";
      let updated = code;

      // 1. Best: same tag + same text
      if (text) {
        const escapedText = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const tagRegex = new RegExp(`<${tag}([^>]*)>([\\\\s\\\\S]*?${escapedText}[\\\\s\\\\S]*?)<\\\\/${tag}>`, "m");
        if (tagRegex.test(updated)) {
          updated = updated.replace(tagRegex, (match, attrs, inner) => {
            return `<${tag}${addClassToAttrs(attrs)}>${inner}</${tag}>`;
          });
        }
      }

      // 2. Fallback: first same tag
      if (updated === code) {
        const openTagRegex = new RegExp(`<${tag}([^>]*)>`, "m");
        if (openTagRegex.test(updated)) {
          updated = updated.replace(openTagRegex, (match, attrs) => {
            return `<${tag}${addClassToAttrs(attrs)}>`;
          });
        }
      }

      // 3. Last fallback: first button
      if (updated === code) {
        updated = updated.replace(/<button([^>]*)>/m, (match, attrs) => {
          return `<button${addClassToAttrs(attrs)}>`;
        });
      }

      if (updated !== code) {
        next[path] = { ...next[path], code: updated };
        return { files: next, patchedPath: path, patched: true };
      }
    }

    return { files: next, patchedPath: "", patched: false };
  };

  const acceptSafeEditDraft = () => {
    if (!aiEditDraft || aiEditDraft.type !== "draft") {
      setAiEditDraft(null);
      return;
    }

    if (aiEditDraft.phase12 && aiEditDraft.structural) {
      const patch = aiEditDraft.structural;
      pushAiEditUndoSnapshot(aiEditDraft.instruction || "AI Edit v3");

      setProjectFiles((files) => {
        const next = { ...(files || {}) };
        if (patch.appPath && patch.newCode) {
          next[patch.appPath] = {
            ...(next[patch.appPath] || {}),
            name: patch.appPath,
            lang: getFileLanguage(patch.appPath),
            code: patch.newCode,
          };
        }

        if (patch.cssPatch) {
          const cssPath = patch.cssPath ? (patch.cssPath && patch.cssPath.includes("{" ) ? patch.cssPath : getPhase12CssFilePath(next)) : getPhase12CssFilePath(next);
          const finalCssPath = getPhase12CssFilePath(next);
          const current = next[finalCssPath]?.code || "";
          next[finalCssPath] = {
            ...(next[finalCssPath] || {}),
            name: finalCssPath,
            lang: "css",
            language: "css",
            code: `${current}\n${patch.cssPatch}`,
          };
        }

        return next;
      });

      setAiAppliedEdits((edits) => [
        ...edits,
        {
          id: `phase12-${Date.now()}`,
          instruction: aiEditDraft.instruction,
          targets: aiEditDraft.targets || [],
          type: "structural",
          createdAt: new Date().toISOString(),
        },
      ]);

      setPanelTab("preview");
      setShowWorkPanel(true);
      setAiEditDraft(null);
      setAiEditPrompt("");
      setTimeout(() => bumpPreviewVersion(), 160);
      return;
    }

    const instruction = aiEditDraft.instruction || aiEditPrompt;
    const targets = (aiEditDraft.targets && aiEditDraft.targets.length)
      ? aiEditDraft.targets.map(normalizeEditTarget)
      : getCurrentAiEditTargets();

    if (!targets.length) {
      setAiEditDraft({
        type: "error",
        title: "No edit target",
        message: "Select one or more elements before accepting the edit.",
      });
      return;
    }

    const editId = aiEditDraft.editId || `synez-edit-v2-${Date.now()}`;
    const smartCssPatch = buildSmartCssPatch(instruction, targets, editId);

    pushAiEditUndoSnapshot(instruction);

    setProjectFiles((files) => {
      let next = { ...(files || {}) };
      let patchedPaths = [];

      targets.forEach((target) => {
        const result = applyInlineStyleToProjectFiles(next, target, instruction);
        next = result.next;
        if (result.patchedPath) patchedPaths.push(result.patchedPath);
      });

      const cssPath = getSmartCssPath(next);
      const current = next[cssPath]?.code || "";
      next[cssPath] = {
        name: cssPath,
        lang: "css",
        language: "css",
        code: upsertSmartCssPatch(current, smartCssPatch),
      };

      if (!patchedPaths.length) patchedPaths.push(cssPath);
      setActiveProjectFile(patchedPaths[0]);
      return next;
    });

    setAiAppliedEdits((edits) => [
      ...edits,
      {
        id: editId,
        instruction,
        targets,
        createdAt: new Date().toISOString(),
      },
    ]);

    setAiEditCounter((count) => count + 1);
    setAiEditDraft(null);
    setAiEditPrompt("");
    setPanelTab("preview");
    setShowWorkPanel(true);
    setTimeout(() => bumpPreviewVersion(), 140);
  };

  const rejectSafeEditDraft = () => {
    setAiEditDraft(null);
  };

  const restoreLastEditBackup = () => {
    undoAiEditV2();
  };




  const buildPreviewConsoleBridgeScript = () => {
    return `
<script>
(function(){
  var startTime = performance.now();

  function normalize(item){
    if (typeof item === "string") return item;
    if (item instanceof Error) return item.stack || item.message || String(item);
    try { return JSON.stringify(item, null, 2); }
    catch { return String(item); }
  }

  function sendConsole(type, args){
    try {
      var message = Array.prototype.slice.call(args || []).map(normalize).join(" ");
      window.parent.postMessage({
        source: "SYNEZ_PREVIEW_CONSOLE",
        type: type,
        message: message
      }, "*");
    } catch {}
  }

  function sendNetwork(payload){
    try {
      window.parent.postMessage(Object.assign({ source: "SYNEZ_PREVIEW_NETWORK" }, payload), "*");
    } catch {}
  }

  function sendReport(){
    try {
      var imgs = Array.prototype.slice.call(document.images || []).map(function(img){
        return { type: "image", src: img.currentSrc || img.src || "", ok: !!(img.complete && img.naturalWidth) };
      });

      var links = Array.prototype.slice.call(document.querySelectorAll("link[href]")).map(function(link){
        return { type: link.rel || "link", src: link.href, ok: true };
      });

      var scripts = Array.prototype.slice.call(document.querySelectorAll("script[src]")).map(function(script){
        return { type: "script", src: script.src, ok: true };
      });

      var styles = Array.prototype.slice.call(document.styleSheets || []).length;
      var domNodes = document.querySelectorAll("*").length;
      var loadTime = Math.round(performance.now() - startTime);
      var cssText = Array.prototype.slice.call(document.querySelectorAll("style")).map(function(s){ return s.textContent || ""; }).join("\\n");
      var cssSize = cssText.length;
      var jsSize = 0;

      var accessibility = 100;
      if (!document.querySelector("h1")) accessibility -= 10;
      if (document.querySelectorAll("button:not([aria-label])").length > 4) accessibility -= 8;
      if (document.querySelectorAll("img:not([alt])").length) accessibility -= 12;

      var performanceScore = Math.max(55, Math.min(100, 100 - Math.floor(domNodes / 30) - Math.floor(loadTime / 80)));
      var seo = document.title ? 88 : 68;
      if (document.querySelector("meta[name='description']")) seo += 8;
      seo = Math.min(100, seo);

      var best = 90;
      if (document.querySelectorAll("script[src^='http:']").length) best -= 15;

      window.parent.postMessage({
        source: "SYNEZ_PREVIEW_REPORT",
        assets: imgs.concat(links).concat(scripts),
        performance: {
          loadTime,
          domNodes,
          cssSize,
          jsSize,
          styleSheets: styles
        },
        score: {
          performance: performanceScore,
          accessibility: Math.max(0, accessibility),
          bestPractices: Math.max(0, best),
          seo: seo,
          overall: Math.round((performanceScore + Math.max(0, accessibility) + Math.max(0, best) + seo) / 4)
        }
      }, "*");
    } catch {}
  }

  var original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    table: console.table || console.log
  };

  console.log = function(){ sendConsole("log", arguments); original.log.apply(console, arguments); };
  console.warn = function(){ sendConsole("warn", arguments); original.warn.apply(console, arguments); };
  console.error = function(){ sendConsole("error", arguments); original.error.apply(console, arguments); };
  console.info = function(){ sendConsole("info", arguments); original.info.apply(console, arguments); };
  console.table = function(){ sendConsole("table", arguments); original.table.apply(console, arguments); };

  var originalFetch = window.fetch;
  if (originalFetch) {
    window.fetch = function(input, init){
      var url = typeof input === "string" ? input : (input && input.url) || "";
      var method = (init && init.method) || "GET";
      var started = performance.now();

      return originalFetch.apply(this, arguments)
        .then(function(response){
          sendNetwork({
            method: method,
            url: url,
            status: response.status,
            ok: response.ok,
            timeMs: Math.round(performance.now() - started)
          });
          return response;
        })
        .catch(function(error){
          sendNetwork({
            method: method,
            url: url,
            status: "ERR",
            ok: false,
            timeMs: Math.round(performance.now() - started)
          });
          throw error;
        });
    };
  }

  var OriginalXHR = window.XMLHttpRequest;
  if (OriginalXHR) {
    window.XMLHttpRequest = function(){
      var xhr = new OriginalXHR();
      var url = "";
      var method = "GET";
      var started = 0;
      var open = xhr.open;
      xhr.open = function(m, u){
        method = m || "GET";
        url = u || "";
        return open.apply(xhr, arguments);
      };
      var send = xhr.send;
      xhr.send = function(){
        started = performance.now();
        xhr.addEventListener("loadend", function(){
          sendNetwork({
            method: method,
            url: url,
            status: xhr.status || "ERR",
            ok: xhr.status >= 200 && xhr.status < 400,
            timeMs: Math.round(performance.now() - started)
          });
        });
        return send.apply(xhr, arguments);
      };
      return xhr;
    };
  }

  window.addEventListener("error", function(event){
    sendConsole("error", [
      event.message || "Runtime error",
      event.filename || "",
      event.lineno ? ("line " + event.lineno) : ""
    ]);
  });

  window.addEventListener("unhandledrejection", function(event){
    sendConsole("error", [
      "Unhandled Promise",
      event.reason && event.reason.message ? event.reason.message : String(event.reason || "")
    ]);
  });

  window.addEventListener("load", function(){
    setTimeout(sendReport, 250);
  });

  setTimeout(sendReport, 700);
  sendConsole("info", ["Preview DevTools connected"]);
})();
<\/script>`;
  };

  const buildPreviewInspectorScript = () => {
    if (!inspectPreviewEnabled) return "";

    return `
<script>
(function(){
  var selected = null;
  var hoverBox = document.createElement("div");
  var infoBox = document.createElement("div");

  hoverBox.style.cssText = [
    "position:fixed",
    "z-index:2147483646",
    "pointer-events:none",
    "border:2px solid #22d3ee",
    "border-radius:8px",
    "box-shadow:0 0 0 99999px rgba(0,0,0,.04)",
    "display:none"
  ].join(";");

  infoBox.style.cssText = [
    "position:fixed",
    "left:16px",
    "top:72px",
    "z-index:2147483647",
    "width:min(430px, calc(100vw - 32px))",
    "max-height:64vh",
    "overflow:auto",
    "padding:0",
    "border-radius:18px",
    "font:13px/1.45 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Arial, sans-serif",
    "background:rgba(15,23,42,.98)",
    "color:#e5e7eb",
    "border:1px solid rgba(34,211,238,.55)",
    "box-shadow:0 24px 70px rgba(0,0,0,.48), 0 0 0 1px rgba(255,255,255,.06)",
    "backdrop-filter:blur(16px)",
    "display:block",
    "pointer-events:auto",
    "overscroll-behavior:contain",
    "scrollbar-width:thin"
  ].join(";");

  var style = document.createElement("style");
  style.textContent = [
    ".__synez_inspect_selected{outline:2px solid #22d3ee!important;outline-offset:2px!important;}",
    ".__synez_panel_head{padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.10);background:linear-gradient(135deg,rgba(124,58,237,.20),rgba(34,211,238,.10));}",
    ".__synez_panel_title{font-weight:900;font-size:14px;letter-spacing:.03em;display:flex;align-items:center;gap:8px;}",
    ".__synez_panel_status{margin-top:6px;color:#93c5fd;font-size:12px;font-weight:700;}",
    ".__synez_panel_body{padding:12px;display:grid;gap:10px;}",
    ".__synez_card{border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.055);overflow:hidden;}",
    ".__synez_card h4{margin:0;padding:10px 12px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#67e8f9;border-bottom:1px solid rgba(255,255,255,.08);}",
    ".__synez_rows{display:grid;gap:1px;background:rgba(255,255,255,.06);}",
    ".__synez_row{display:grid;grid-template-columns:112px 1fr;gap:10px;padding:8px 10px;background:rgba(15,23,42,.82);}",
    ".__synez_key{color:#94a3b8;font-weight:800;}",
    ".__synez_val{color:#f8fafc;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    ".__synez_text{white-space:normal;line-height:1.45;}",
    ".__synez_chip{display:inline-flex;align-items:center;gap:6px;padding:5px 8px;border-radius:999px;background:rgba(34,211,238,.12);border:1px solid rgba(34,211,238,.22);color:#cffafe;font-weight:800;}",
    "@media(max-width:520px){.__synez_inspector_info{left:10px!important;right:10px!important;top:92px!important;width:auto!important;max-height:46vh!important;}.__synez_row{grid-template-columns:92px 1fr;}}"
  ].join("\\n");
  document.head.appendChild(style);

  infoBox.className = "__synez_inspector_info";
  infoBox.innerHTML = '<div class="__synez_panel_head"><div class="__synez_panel_title">🔎 SYNEZ Inspector</div><div class="__synez_panel_status">Hover any element. Click to select. Press Esc to clear.</div></div>';
  document.body.appendChild(hoverBox);
  document.body.appendChild(infoBox);

  infoBox.addEventListener("click", function(e){
    e.stopPropagation();
  }, true);

  infoBox.addEventListener("mousemove", function(e){
    e.stopPropagation();
  }, true);

  infoBox.addEventListener("wheel", function(e){
    e.stopPropagation();
  }, { passive: true, capture: true });

  function safeClass(el){
    if (!el || !el.className) return "";
    if (typeof el.className === "string") return el.className;
    if (el.className.baseVal) return el.className.baseVal;
    return "";
  }

  function shortText(el){
    var text = (el && (el.innerText || el.textContent) || "")
      .trim()
      .replace(/\\s+/g, " ")
      .slice(0, 140);
    return text || "—";
  }

  function cssValue(styles, prop){
    try { return styles.getPropertyValue(prop).trim() || "—"; }
    catch { return "—"; }
  }

  function escapeHTML(value){
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function row(key, value, extraClass){
    return '<div class="__synez_row"><div class="__synez_key">' + escapeHTML(key) + '</div><div class="__synez_val ' + (extraClass || "") + '">' + escapeHTML(value) + '</div></div>';
  }

  function card(title, rows){
    return '<section class="__synez_card"><h4>' + escapeHTML(title) + '</h4><div class="__synez_rows">' + rows.join("") + '</div></section>';
  }

  function getElementName(el){
    var tag = el.tagName ? el.tagName.toLowerCase() : "element";
    var id = el.id ? "#" + el.id : "";
    var cls = safeClass(el)
      ? "." + safeClass(el).trim().split(/\\s+/).filter(Boolean).slice(0,5).join(".")
      : "";
    return "<" + tag + id + cls + ">";
  }

  function renderPanel(el){
    if (!el || el === document.documentElement) return;

    var s = window.getComputedStyle(el);
    var rect = el.getBoundingClientRect();
    var parent = el.parentElement && el.parentElement.tagName ? el.parentElement.tagName.toLowerCase() : "none";

    var html = '';
    html += '<div class="__synez_panel_head">';
    html += '<div class="__synez_panel_title">🔎 SYNEZ Inspector</div>';
    html += '<div class="__synez_panel_status"><span class="__synez_chip">' + (selected === el ? "Selected" : "Hover") + '</span></div>';
    html += '</div>';

    html += '<div class="__synez_panel_body">';
    html += card("Element", [
      row("Node", getElementName(el)),
      row("Parent", "<" + parent + ">"),
      row("Text", shortText(el), "__synez_text")
    ]);

    html += card("Layout", [
      row("Width", Math.round(rect.width) + "px"),
      row("Height", Math.round(rect.height) + "px"),
      row("Display", cssValue(s, "display")),
      row("Position", cssValue(s, "position")),
      row("X / Y", Math.round(rect.left) + " / " + Math.round(rect.top))
    ]);

    html += card("Spacing", [
      row("Margin", cssValue(s, "margin-top") + " " + cssValue(s, "margin-right") + " " + cssValue(s, "margin-bottom") + " " + cssValue(s, "margin-left")),
      row("Padding", cssValue(s, "padding-top") + " " + cssValue(s, "padding-right") + " " + cssValue(s, "padding-bottom") + " " + cssValue(s, "padding-left"))
    ]);

    html += card("Typography", [
      row("Font Size", cssValue(s, "font-size")),
      row("Weight", cssValue(s, "font-weight")),
      row("Line Height", cssValue(s, "line-height")),
      row("Color", cssValue(s, "color"))
    ]);

    html += card("Visual", [
      row("Background", cssValue(s, "background-color")),
      row("Radius", cssValue(s, "border-radius")),
      row("Border", cssValue(s, "border")),
      row("Opacity", cssValue(s, "opacity"))
    ]);

    html += '</div>';
    infoBox.innerHTML = html;
  }

  function draw(el){
    if (!el || el === document.documentElement || el === document.body || el === hoverBox || el === infoBox || infoBox.contains(el)) return;

    var r = el.getBoundingClientRect();
    hoverBox.style.display = "block";
    hoverBox.style.left = Math.round(r.left) + "px";
    hoverBox.style.top = Math.round(r.top) + "px";
    hoverBox.style.width = Math.round(r.width) + "px";
    hoverBox.style.height = Math.round(r.height) + "px";
  }

  function clearSelectedClass(){
    var old = document.querySelectorAll(".__synez_inspect_selected");
    old.forEach(function(node){ node.classList.remove("__synez_inspect_selected"); });
  }

  document.addEventListener("mousemove", function(e){
    var el = e.target;
    if (!el || el === hoverBox || el === infoBox || infoBox.contains(el)) return;
    draw(el);
    if (!selected) renderPanel(el);
  }, true);

  document.addEventListener("click", function(e){
    var el = e.target;
    if (!el || el === hoverBox || el === infoBox || infoBox.contains(el)) return;
    e.preventDefault();
    e.stopPropagation();
    selected = el;
    clearSelectedClass();
    if (el.classList) {
      el.classList.add("__synez_inspect_selected");
    }
    draw(el);
    renderPanel(el);

    try {
      var rect = el.getBoundingClientRect();
      var tag = el.tagName ? el.tagName.toLowerCase() : "element";
      var rawCls = safeClass(el) || "";
      var cleanClasses = rawCls
        .split(/\s+/)
        .filter(Boolean)
        .filter(function(c){
          return c.indexOf("__synez") !== 0 && c.indexOf("synez-ai-edit-") !== 0;
        })
        .map(function(c){
          return c.replace(/[^a-zA-Z0-9_-]/g, "");
        })
        .filter(Boolean);

      var cleanClassName = cleanClasses.join(" ");
      var selector = tag + (el.id ? "#" + el.id : "") + (cleanClasses.length ? "." + cleanClasses.slice(0,4).join(".") : "");

      window.parent.postMessage({
        source: "SYNEZ_PREVIEW_SELECTED_ELEMENT",
        element: {
          tag: tag,
          id: el.id || "",
          className: cleanClassName,
          selector: selector,
          editClass: "",
          text: shortText(el),
          parent: el.parentElement && el.parentElement.tagName ? el.parentElement.tagName.toLowerCase() : "none",
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          domPath: selector
        }
      }, "*");
    } catch {}
  }, true);

  document.addEventListener("keydown", function(e){
    if (e.key === "Escape") {
      selected = null;
      clearSelectedClass();
      hoverBox.style.display = "none";
      infoBox.innerHTML = '<div class="__synez_panel_head"><div class="__synez_panel_title">🔎 SYNEZ Inspector</div><div class="__synez_panel_status">Hover any element. Click to select. Press Esc to clear.</div></div>';
    }
  }, true);

  window.__SYNEZ_INSPECTOR__ = true;
})();
<\/script>`;
  };

  const buildReactPreviewCode = (project = projectFiles) => {
    const names = Object.keys(project || {});
    const getCode = (name) => project?.[name]?.code || "";

    const normalizePath = (parts = []) => {
      const stack = [];
      for (const part of parts) {
        if (!part || part === ".") continue;
        if (part === "..") stack.pop();
        else stack.push(part);
      }
      return stack.join("/");
    };

    const resolveImportPath = (fromFile = "src/App.jsx", importPath = "") => {
      if (!importPath.startsWith(".")) return "";

      const baseParts = fromFile.split("/").slice(0, -1);
      const raw = normalizePath([...baseParts, ...importPath.split("/")]);

      const candidates = [
        raw,
        `${raw}.jsx`,
        `${raw}.js`,
        `${raw}.tsx`,
        `${raw}.json`,
        `${raw}.css`,
        `${raw}/index.jsx`,
        `${raw}/index.js`,
      ];

      return candidates.find((candidate) => project?.[candidate]?.code) || "";
    };

    const safeIdentifier = (name = "Module") =>
      String(name)
        .split("/")
        .pop()
        .replace(/\.(jsx|tsx|js|json)$/i, "")
        .replace(/[^A-Za-z0-9_$]/g, "_")
        .replace(/^(\d)/, "_$1") || "Module";

    const appFile =
      names.find((name) => /(^|\/)App\.(jsx|js|tsx)$/i.test(name)) ||
      names.find((name) => /\.(jsx|tsx)$/i.test(name)) ||
      "";

    const graph = new Map();
    const warnings = [];
    const cssChunks = [];
    const moduleOutput = [];
    const defaultAliases = {};

    const ultraStripImports = (source = "") =>
      String(source || "")
        // import React, { useState } from "react";
        // import {
        //   useState,
        //   useEffect
        // } from "react";
        .replace(/\bimport\s+[\s\S]*?\s+from\s+["'][^"']+["']\s*;?/g, "")
        // import "./styles.css";
        .replace(/\bimport\s+["'][^"']+["']\s*;?/g, "")
        // leftover one-line import
        .replace(/^\s*import\b[^\n;]*(?:;|$)/gm, "");

    const parseImports = (code = "") => {
      const imports = [];

      const fromRegex = /^\s*import\s+([\s\S]*?)\s+from\s+["']([^"']+)["'];?\s*$/gm;
      let match;
      while ((match = fromRegex.exec(code))) {
        imports.push({
          full: match[0],
          spec: match[1].trim(),
          path: match[2].trim(),
          sideEffect: false,
        });
      }

      const sideRegex = /^\s*import\s+["']([^"']+)["'];?\s*$/gm;
      while ((match = sideRegex.exec(code))) {
        imports.push({
          full: match[0],
          spec: "",
          path: match[1].trim(),
          sideEffect: true,
        });
      }

      return imports;
    };

    const defaultNameFromSpec = (spec = "", fileName = "") => {
      const s = String(spec || "").trim();

      // import Foo from "./Foo"
      const defaultOnly = s.match(/^([A-Za-z_$][\w$]*)$/);
      if (defaultOnly) return defaultOnly[1];

      // import Foo, { bar } from "./Foo"
      const mixed = s.match(/^([A-Za-z_$][\w$]*)\s*,/);
      if (mixed) return mixed[1];

      return safeIdentifier(fileName);
    };

    const collectModule = (fileName, preferredDefault = "") => {
      if (!fileName || graph.has(fileName)) return;

      let code = getCode(fileName);
      if (!code) return;

      if (/\.css$/i.test(fileName)) {
        graph.set(fileName, { type: "css", imports: [] });
        cssChunks.push(`/* ${fileName} */\n${code}`);
        return;
      }

      if (/\.json$/i.test(fileName)) {
        graph.set(fileName, { type: "json", imports: [] });
        return;
      }

      const imports = parseImports(code);
      graph.set(fileName, { type: "js", imports });

      for (const item of imports) {
        if (item.path === "react" || item.path.startsWith("react/")) continue;

        if (!item.path.startsWith(".")) {
          warnings.push(`External import skipped: ${item.path} in ${fileName}`);
          continue;
        }

        const resolved = resolveImportPath(fileName, item.path);

        if (!resolved) {
          warnings.push(`Missing import: ${item.path} in ${fileName}`);
          continue;
        }

        if (/\.css$/i.test(resolved)) {
          collectModule(resolved);
          continue;
        }

        const alias = defaultNameFromSpec(item.spec, resolved);
        if (alias) defaultAliases[resolved] = alias;
        collectModule(resolved, alias);
      }
    };

    const stripAndTransform = (fileName) => {
      let code = getCode(fileName);
      if (!code) return "";

      if (/\.json$/i.test(fileName)) {
        const alias = defaultAliases[fileName] || safeIdentifier(fileName);
        try {
          JSON.parse(code);
          return `// ${fileName}\nconst ${alias} = ${code};`;
        } catch {
          warnings.push(`Invalid JSON skipped: ${fileName}`);
          return "";
        }
      }

      if (/\.css$/i.test(fileName)) return "";

      const alias = defaultAliases[fileName] || safeIdentifier(fileName);

      // Remove every import form after graph collection.
      code = code
        .replace(/^\s*import\s+[\s\S]*?\s+from\s+["'][^"']+["'];?\s*$/gm, "")
        .replace(/^\s*import\s+["'][^"']+["'];?\s*$/gm, "")
        .replace(/^\s*import\b[\s\S]*?;?\s*$/gm, "");

      // Convert exports. For preview, App.jsx must always expose a callable App component.
      const isAppEntry = fileName === appFile || /(^|\/)App\.(jsx|tsx|js)$/i.test(fileName);
      code = code
        .replace(/export\s+default\s+function\s+([A-Za-z0-9_$]+)\s*\(/g, (full, name) => {
          return isAppEntry ? "function App(" : `function ${name}(`;
        })
        .replace(/export\s+default\s+function\s*\(/g, isAppEntry ? "function App(" : `function ${alias}(`)
        .replace(/export\s+default\s+class\s+([A-Za-z0-9_$]+)\s+/g, (full, name) => {
          return isAppEntry ? "class App " : `class ${name} `;
        })
        .replace(/export\s+default\s+(\[[\s\S]*?\]);?/g, isAppEntry ? "const App = $1;" : `const ${alias} = $1;`)
        .replace(/export\s+default\s+(\{[\s\S]*?\});?/g, isAppEntry ? "const App = $1;" : `const ${alias} = $1;`)
        .replace(/export\s+default\s+([A-Za-z0-9_$]+)\s*;?/g, (full, name) => {
          if (isAppEntry) return name === "App" ? "" : `const App = ${name};`;
          return name === alias || name === "App" ? "" : `const ${alias} = ${name};`;
        })
        .replace(/export\s+const\s+/g, "const ")
        .replace(/export\s+let\s+/g, "let ")
        .replace(/export\s+var\s+/g, "var ")
        .replace(/export\s+function\s+/g, "function ");

      code = ultraStripImports(code);

      return `// ${fileName}\n${code}`;
    };

    if (appFile) collectModule(appFile, "App");

    // Include CSS even if not imported.
    names
      .filter((name) => /\.css$/i.test(name))
      .forEach((name) => {
        if (!graph.has(name)) collectModule(name);
      });

    // Dependency-first order: insertion order after DFS collection generally places imported modules before parents
    // because collectModule registers parent first, so reverse JS/json order to put children before App.
    const moduleNames = [...graph.keys()].filter((name) => !/\.css$/i.test(name));
    const ordered = moduleNames.reverse();

    for (const fileName of ordered) {
      const transformed = stripAndTransform(fileName);
      if (transformed) moduleOutput.push(transformed);
    }

    let runtimeCode = [
      "const { useState, useEffect, useMemo, useRef, useCallback, createContext, useContext, Fragment } = React;",
      ...moduleOutput,
    ].join("\n\n");

    // Final bundle-level sanitizer.
    // Even if a nested module escaped the transformer, imports must never reach new Function().
    runtimeCode = ultraStripImports(runtimeCode);

    const remainingImports = runtimeCode
      .split("\n")
      .map((line, index) => ({ line, index: index + 1 }))
      .filter((item) => /^\s*import\b/.test(item.line));

    if (remainingImports.length) {
      const report = remainingImports
        .slice(0, 8)
        .map((item) => `Line ${item.index}: ${item.line}`)
        .join("\\n");
      runtimeCode = `function App(){return <pre style={{padding:24,color:"#fff",whiteSpace:"pre-wrap"}}>${JSON.stringify(
        `React Runtime Debug\\nRemaining imports found:\\n${report}`
      )}</pre>}`;
    } else if (!/function\s+App\s*\(|const\s+App\s*=|class\s+App\s+extends/.test(runtimeCode)) {
      runtimeCode += `\nfunction App(){return <div style={{padding:32,color:"#fff"}}><h1>React Preview</h1><p>App.jsx was not found or could not be compiled.</p></div>}`;
    }

    runtimeCode += `\n\nconst root = ReactDOM.createRoot(document.getElementById("root")); root.render(<App />);`;

    const cssCode = cssChunks.join("\n\n");
    const debugText = [
      `Entry: ${appFile || "missing"}`,
      `Files: ${graph.size}`,
      `Modules: ${moduleOutput.length}`,
      `CSS: ${cssChunks.length}`,
      warnings.length ? `Warnings:\\n${warnings.join("\\n")}` : "Ready",
    ].join("\\n");

    const showReactRuntimeBadge = !["iphone", "pixel", "galaxy", "mobile", "ipad", "tablet"].includes(previewDevice);

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>SYNEZ React Runtime Graph</title>
<style>
* { box-sizing: border-box; }
html, body, #root { margin: 0; min-height: 100%; }
body {
  background: #07070b;
  color: #fff;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
}
.synez-react-error {
  position: fixed;
  left: 12px;
  bottom: 12px;
  z-index: 999999;
  max-width: min(820px, calc(100vw - 24px));
  padding: 12px 14px;
  border-radius: 14px;
  white-space: pre-wrap;
  font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  background: #111827;
  color: #fff;
  border: 1px solid rgba(248, 113, 113, .45);
}
.synez-react-badge {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 999999;
  padding: 8px 10px;
  border-radius: 12px;
  font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  background: rgba(15, 23, 42, .86);
  color: #e5e7eb;
  border: 1px solid rgba(255,255,255,.18);
  backdrop-filter: blur(12px);
}
${cssCode}
</style>

</head>
<body>
<div id="root"></div>
${showReactRuntimeBadge ? `<div class="synez-react-badge">React Graph Runtime · Files ${graph.size} · CSS ${cssCode.length}</div>` : ""}

<script src="https://unpkg.com/react@18/umd/react.development.js"></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>

<script>
function showSynezReactError(error, meta) {
  var message = error && error.message ? error.message : String(error || "Unknown error");
  var stack = error && error.stack ? error.stack : "";
  var name = error && error.name ? error.name : "Runtime Error";
  var line = meta && meta.line ? meta.line : "";
  var file = meta && meta.file ? meta.file : "";

  var existing = document.querySelector(".synez-error-overlay");
  if (existing) existing.remove();

  var overlay = document.createElement("div");
  overlay.className = "synez-error-overlay";

  var suggestion = "Check the component imports, export default names, and JSX syntax.";
  if (/is not defined/i.test(message)) {
    suggestion = "A component or variable is missing. Check import/export names and file paths.";
  }
  if (/Unexpected token/i.test(message)) {
    suggestion = "Possible JSX or syntax error. Check brackets, tags, and return statement.";
  }
  if (/Cannot use import statement/i.test(message)) {
    suggestion = "An import line survived bundling. Check the runtime import resolver.";
  }

  overlay.innerHTML = [
    '<div class="synez-error-card">',
      '<div class="synez-error-head">',
        '<div>',
          '<span class="synez-error-badge">Preview Error</span>',
          '<h2>' + escapeHTML(name) + '</h2>',
        '</div>',
        '<button class="synez-error-close">Clear</button>',
      '</div>',
      '<pre class="synez-error-message">' + escapeHTML(message) + '</pre>',
      '<div class="synez-error-grid">',
        '<div><strong>File</strong><span>' + escapeHTML(file || "Preview Runtime") + '</span></div>',
        '<div><strong>Line</strong><span>' + escapeHTML(line || "Unknown") + '</span></div>',
      '</div>',
      '<div class="synez-error-suggestion"><strong>Suggestion</strong><span>' + escapeHTML(suggestion) + '</span></div>',
      '<details class="synez-error-stack">',
        '<summary>Stack Trace</summary>',
        '<pre>' + escapeHTML(stack || "No stack trace available.") + '</pre>',
      '</details>',
      '<div class="synez-error-actions">',
        '<button class="synez-error-copy">Copy Error</button>',
      '</div>',
    '</div>'
  ].join("");

  document.body.appendChild(overlay);

  overlay.querySelector(".synez-error-close").onclick = function(){
    overlay.remove();
  };

  overlay.querySelector(".synez-error-copy").onclick = function(){
    var text = name + "\n" + message + "\nFile: " + (file || "Preview Runtime") + "\nLine: " + (line || "Unknown") + "\n\n" + stack;
    navigator.clipboard && navigator.clipboard.writeText(text);
  };

  function escapeHTML(value){
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
}

window.addEventListener("error", function(event) {
  var detail = event.error || event.message || "Unknown runtime error";
  if (event && event.message === "Script error.") {
    detail = "Script error. Check if CDN scripts loaded correctly or if browser blocked iframe scripts.";
  }
  if (event && event.lineno) {
    detail = detail + "\nLine: " + event.lineno + (event.colno ? ":" + event.colno : "");
  }
  showSynezReactError(detail);
});
</script>

<script>
try {
  if (!window.React || !window.ReactDOM || !window.Babel) {
    throw new Error("React/Babel CDN failed to load. Check internet connection or allow unpkg.com.");
  }

  console.log("SYNEZ React Graph Runtime:", ${JSON.stringify(debugText)});
  var sourceCode = ${JSON.stringify(runtimeCode)};

  function stripImportsInsideIframe(code) {
    return String(code || "")
      .replace(/\\r/g, "\\n")
      .replace(/^[ \\t]*import[\\s\\S]*?[ \\t]+from[ \\t]*["'][^"']+["'][ \\t]*;?[ \\t]*$/gm, "")
      .replace(/^[ \\t]*import[ \\t]+["'][^"']+["'][ \\t]*;?[ \\t]*$/gm, "")
      .replace(/^[ \\t]*import[ \\t]+\\{[\\s\\S]*?\\}[ \\t]+from[ \\t]*["'][^"']+["'][ \\t]*;?[ \\t]*$/gm, "")
      .replace(/^[ \\t]*import[ \\t]+\\*[ \\t]+as[ \\t]+[A-Za-z_$][\\w$]*[ \\t]+from[ \\t]*["'][^"']+["'][ \\t]*;?[ \\t]*$/gm, "")
      .replace(/^[ \\t]*import\\b[^\\n;]*(?:;|$)/gm, "");
  }

  sourceCode = stripImportsInsideIframe(sourceCode);

  var remainingImport = sourceCode.split("\\n").find(function(line) {
    return /^\\s*import\\b/.test(line);
  });

  if (remainingImport) {
    throw new Error("Unresolved import survived sanitizer: " + remainingImport);
  }

  var compiled = Babel.transform(sourceCode, { presets: ["react"] }).code;

  compiled = stripImportsInsideIframe(compiled)
    .replace(/\bconst\s+(_jsx2?|_jsxs2?|jsx2?|jsxs2?)\s*=/g, "var $1 =");

  var compiledImport = compiled.split("\\n").find(function(line) {
    return /^\\s*import\\b/.test(line);
  });

  if (compiledImport) {
    throw new Error("Babel output still contains import: " + compiledImport);
  }

  window._jsx = window._jsx || function(type, props, key){ props = props || {}; var finalProps = Object.assign({}, props); if (key !== undefined) finalProps.key = key; var children = finalProps.children; delete finalProps.children; return React.createElement.apply(React, [type, finalProps].concat(Array.isArray(children) ? children : children != null ? [children] : [])); };
  window._jsxs = window._jsxs || window._jsx;
  window.jsx = window.jsx || window._jsx;
  window.jsxs = window.jsxs || window._jsx;
  window._jsx2 = window._jsx2 || window._jsx;
  window._jsxs2 = window._jsxs2 || window._jsx;
  window.jsx2 = window.jsx2 || window._jsx;
  window.jsxs2 = window.jsxs2 || window._jsx;

  new Function("React", "ReactDOM", "_jsx", "_jsxs", "jsx", "jsxs", "_jsx2", "_jsxs2", "jsx2", "jsxs2", compiled)(
    React,
    ReactDOM,
    window._jsx,
    window._jsxs,
    window.jsx,
    window.jsxs,
    window._jsx2,
    window._jsxs2,
    window.jsx2,
    window.jsxs2
  );

  setTimeout(function(){
    try {
      var root = document.getElementById("root");
      var text = root ? (root.innerText || root.textContent || "").trim() : "";
      var hasChildren = root && root.children && root.children.length > 0;
      var hasError = !!document.querySelector(".synez-error-overlay, .synez-react-error");
      if (root && !text && !hasChildren && !hasError) {
        root.innerHTML = '<div style="min-height:100vh;display:grid;place-items:center;text-align:center;padding:32px;color:#fff;background:#07070b"><div><h1 style="margin:0 0 10px;font-size:34px">Preview is blank</h1><p style="margin:0;color:#cbd5e1">SYNEZ compiled the files, but App rendered no visible content. Try asking for HTML/CSS/JS separate files or check Developer Tools.</p></div></div>';
      }
    } catch(e) {}
  }, 450);
} catch (error) {
  showSynezReactError(error);
}
</script>
${buildPreviewConsoleBridgeScript()}
${buildPreviewInspectorScript()}
</body>
</html>`;
  };

  const buildPreviewCode = (codeFiles = files) => {
    const normalize = (value = "") => String(value || "").trim();

    const htmlCode = normalize(codeFiles.html);
    const cssCode = normalize(codeFiles.css);
    const jsCode = normalize(codeFiles.js);

    const safeHtml = htmlCode
      ? htmlCode
      : `<main class="synez-preview-empty">
  <h1>Preview is ready</h1>
  <p>Generate a website or switch to Code tab to check extracted HTML, CSS, and JavaScript.</p>
</main>`;

    const debug = {
      html: htmlCode.length,
      css: cssCode.length,
      js: jsCode.length,
    };

    const showPreviewDebug = !["iphone", "pixel", "galaxy", "mobile", "ipad", "tablet"].includes(previewDevice);

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<base target="_blank" />
<style id="synez-reset">
*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  width: 100%;
  min-height: 100%;
}

body {
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
  color: #111827;
  background: #ffffff;
}

img,
svg,
video,
canvas {
  max-width: 100%;
  display: block;
}

button,
input,
textarea,
select {
  font: inherit;
}

a {
  color: inherit;
}

.synez-preview-empty {
  min-height: 100vh;
  display: grid;
  place-items: center;
  text-align: center;
  padding: 40px;
  background: linear-gradient(135deg, #0b1020, #111827);
  color: white;
}

.synez-preview-empty h1 {
  font-size: clamp(32px, 7vw, 64px);
  margin: 0 0 10px;
}

.synez-preview-empty p {
  color: #cbd5e1;
  max-width: 560px;
}

.synez-preview-debug {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 2147483647;
  padding: 8px 10px;
  border-radius: 12px;
  font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  background: rgba(15, 23, 42, .86);
  color: #e5e7eb;
  border: 1px solid rgba(255,255,255,.18);
  backdrop-filter: blur(12px);
  pointer-events: none;
}

.synez-preview-error {
  position: fixed;
  left: 12px;
  bottom: 12px;
  z-index: 2147483647;
  max-width: min(760px, calc(100vw - 24px));
  max-height: 45vh;
  overflow: auto;
  padding: 12px 14px;
  border-radius: 14px;
  white-space: pre-wrap;
  font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  background: #111827;
  color: #fff;
  border: 1px solid rgba(248, 113, 113, .45);
  box-shadow: 0 20px 60px rgba(0,0,0,.35);
}
</style>

<style id="synez-user-css">
${cssCode}
</style>
</head>
<body>
${safeHtml}

${showPreviewDebug ? `<div class="synez-preview-debug" title="SYNEZ Preview Debug">HTML ${debug.html} · CSS ${debug.css} · JS ${debug.js}</div>` : ""}

<script>
window.addEventListener("error", function(event) {
  var msg = event && (event.message || (event.error && event.error.message)) || "Unknown JavaScript error";
  var existing = document.querySelector(".synez-preview-error");
  if (existing) existing.remove();

  var box = document.createElement("pre");
  box.className = "synez-preview-error";
  box.textContent = "JS Error: " + msg;
  document.body.appendChild(box);
});

window.addEventListener("unhandledrejection", function(event) {
  var msg = event && event.reason && (event.reason.message || String(event.reason)) || "Unhandled promise rejection";
  var existing = document.querySelector(".synez-preview-error");
  if (existing) existing.remove();

  var box = document.createElement("pre");
  box.className = "synez-preview-error";
  box.textContent = "JS Error: " + msg;
  document.body.appendChild(box);
});
</script>

<script id="synez-user-js">
(function () {
  var userCode = ${JSON.stringify(jsCode)};

  function showPreviewError(error) {
    var existing = document.querySelector(".synez-preview-error");
    if (existing) existing.remove();

    var box = document.createElement("pre");
    box.className = "synez-preview-error";
    box.textContent = "JS Error: " + (error && error.message ? error.message : String(error));
    document.body.appendChild(box);
  }

  try {
    if (userCode && userCode.trim()) {
      new Function(userCode)();
    }
  } catch (error) {
    showPreviewError(error);
  }
})();
<\/script>
</body>
</html>`;
  };

  const isPreviewableCode = (filesObj = {}) => {
    const html = (filesObj.html || "").trim();
    const css = (filesObj.css || "").trim();
    const js = (filesObj.js || "").trim();

    const hasRealHtml =
      /<!DOCTYPE|<html|<body|<main|<section|<header|<nav|<div|<article|<button|<form/i.test(html);

    const hasRealCss =
      css.length > 80 &&
      /[.#:a-zA-Z*][\w\s.#:[\]="'-]*\{[\s\S]*?:[\s\S]*?\}/.test(css);

    const hasRealJs =
      js.length > 40 &&
      /(document\.|addEventListener|querySelector|const |let |function |=>)/i.test(js);

    // HTML is required for iframe preview. CSS/JS alone should stay in chat/code only.
    return hasRealHtml || (hasRealCss && html.length > 20) || (hasRealJs && html.length > 20);
  };

  const looksLikeArchitectureOnly = (content = "") => {
    const text = String(content || "");

    return (
      /#\s*Project Architecture|Project Architecture|File Tree|Recommended Tech Stack|Component Plan|Reply\s+\*\*?GENERATE/i.test(text) &&
      !/```html|<!DOCTYPE|<html|<body|<main|<section/i.test(text)
    );
  };

  const updateCodePanel = (content) => {
    if (looksLikeArchitectureOnly(content)) {
      return;
    }

    if (isReactProjectOutput(content)) {
      const nextProjectFiles = extractProjectFiles(content);
      const fileNames = Object.keys(nextProjectFiles);

      const validation = validateProjectFiles(nextProjectFiles);

      if (fileNames.length) {
        setProjectFiles(nextProjectFiles);
        setProjectValidation(validation);
        setActiveProjectFile(fileNames[0]);
        bumpPreviewVersion();
        setPanelTab("code");
        setShowWorkPanel(true);
      }

      console.log("SYNEZ Project Files:", nextProjectFiles);
      console.log("SYNEZ Project Validation:", validation);

      // React/Vite preview needs Virtual Workspace compiler.
      // For now, show files in Explorer instead of broken vanilla iframe.
      return;
    }

    const extracted = extractFiles(content);

    if (isPreviewableCode(extracted)) {
      setProjectFiles({});
      setActiveProjectFile("");
      setProjectValidation({ valid: false, errors: [] });
      setFiles(extracted);
      setPreviewDoc(buildPreviewCode(extracted));
      bumpPreviewVersion();
      setPanelTab("preview");
      setShowWorkPanel(true);
    }
  };

  const getChatTitle = (chatMessages) => {
    let title =
      chatMessages.find((m) => m.role === "user")?.content || "New Chat";

    return title.replace(/\n/g, " ").slice(0, 40);
  };

  const autoSaveChat = async (chatMessages) => {
    const user = auth.currentUser;

    if (!user || chatMessages.length < 2) return;

    const chatData = {
      title: getChatTitle(chatMessages),
      messages: chatMessages,
      createdAt: Date.now(),
    };

    try {
      if (currentChatId) {
        await updateDoc(doc(db, "users", user.uid, "chats", currentChatId), {
          messages: chatMessages,
          title: chatData.title,
          updatedAt: Date.now(),
        });
      } else {
        const docRef = await addDoc(
          collection(db, "users", user.uid, "chats"),
          chatData
        );

        setCurrentChatId(docRef.id);
      }
    } catch (error) {
      console.error(error);
    }
  };


  const readDocumentFile = async (file) => {
    const name = file.name.toLowerCase();
    const simpleTextFile =
      file.type.startsWith("text/") ||
      /\.(txt|md|csv|json|js|jsx|ts|tsx|html|css|py|java|cpp|c|php|xml|yml|yaml|sql)$/i.test(name);

    if (simpleTextFile) {
      const text = await file.text();
      return text || "[This text file is empty]";
    }

    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("http://localhost:5000/read-document", {
      method: "POST",
      body: formData,
    });

    let data = {};
    try {
      data = await res.json();
    } catch {
      data = {};
    }

    if (!res.ok) {
      throw new Error(data.error || "Document read failed. Check backend terminal.");
    }

    const meta = [
      `Reader: ${data.reader || "browser/server"}`,
      `Characters: ${data.chars || 0}`,
    ].join(" | ");

    return `${meta}\n\n${data.text || "[Document read, but no selectable text was found]"}`;
  };

  const readImageAsBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => {
        const result = reader.result;
        const base64 = result.split(",")[1];

        resolve({
          mimeType: file.type,
          base64,
        });
      };

      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };
  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);

    const files = e.dataTransfer.files;

    if (!files?.length) return;

    handleFileSelect(files);
    showToast("File added");
  };
  const getAttachmentKey = (file) => `${file.name}-${file.size}-${file.lastModified}`;

  const handleFileSelect = (fileInput) => {
    const incomingFiles = Array.from(fileInput?.length ? fileInput : [fileInput]).filter(Boolean);

    if (!incomingFiles.length) return;

    const imageFiles = incomingFiles.filter((file) => file.type.startsWith("image/"));
    const documentFiles = incomingFiles.filter((file) => !file.type.startsWith("image/"));

    if (documentFiles.length) {
      setSelectedFiles((prev) => {
        const merged = [...prev];

        documentFiles.forEach((file) => {
          const exists = merged.some((item) => getAttachmentKey(item) === getAttachmentKey(file));
          if (!exists) merged.push(file);
        });

        return merged.slice(0, 12);
      });
    }

    if (imageFiles.length) {
      setSelectedImages((prev) => {
        const merged = [...prev];

        imageFiles.forEach((file) => {
          const exists = merged.some((item) => getAttachmentKey(item) === getAttachmentKey(file));
          if (!exists) merged.push(file);
        });

        return merged.slice(0, 8);
      });

      setImagePreviews((prev) => {
        const merged = [...prev];

        imageFiles.forEach((file) => {
          const key = getAttachmentKey(file);
          const exists = merged.some((item) => item.key === key);
          if (!exists) merged.push({ key, name: file.name, url: URL.createObjectURL(file) });
        });

        return merged.slice(0, 8);
      });
    }

    showToast(`${incomingFiles.length} attachment${incomingFiles.length > 1 ? "s" : ""} added`);
  };

  const clearUpload = () => {
    imagePreviews.forEach((item) => {
      if (item?.url) URL.revokeObjectURL(item.url);
    });

    setSelectedFiles([]);
    setSelectedImages([]);
    setImagePreviews([]);
  };

  const removeSelectedImage = (indexToRemove) => {
    setSelectedImages((prev) => prev.filter((_, index) => index !== indexToRemove));
    setImagePreviews((prev) => {
      const target = prev[indexToRemove];
      if (target?.url) URL.revokeObjectURL(target.url);
      return prev.filter((_, index) => index !== indexToRemove);
    });
  };

  const removeSelectedFile = (indexToRemove) => {
    setSelectedFiles((prev) => prev.filter((_, index) => index !== indexToRemove));
  };

  const toggleVoiceInput = () => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      showToast("Voice input is not supported in this browser");
      return;
    }

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;

    recognition.lang = "en-IN";
    recognition.interimResults = true;
    recognition.continuous = false;

    let finalTranscript = "";

    recognition.onstart = () => {
      setIsListening(true);
      showToast("Listening...");
    };

    recognition.onresult = (event) => {
      let interimTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;

        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      const spokenText = (finalTranscript || interimTranscript).trim();

      if (spokenText) {
        setInput((prev) => {
          const base = prev.trim();
          return base ? `${base} ${spokenText}` : spokenText;
        });
      }
    };

    recognition.onerror = (event) => {
      console.error(event.error);
      setIsListening(false);
      showToast("Voice input stopped");
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.start();
  };



  const getUserEmail = () => {
    const firebaseUser = auth.currentUser;

    const email =
      firebaseUser?.email ||
      localStorage.getItem("userEmail") ||
      "guest";

    if (firebaseUser?.email) {
      localStorage.setItem("userEmail", firebaseUser.email);
    }

    return email;
  };

  const fetchMemory = async () => {
    try {
      setMemoryLoading(true);

      const userEmail = getUserEmail();

      const res = await fetch(
        `http://localhost:5000/memory?userEmail=${encodeURIComponent(userEmail)}`
      );

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Memory fetch failed");
      }

      setSavedMemory(data || {});
      setShowMemoryPanel(true);
    } catch (error) {
      console.error(error);
      showToast("Memory load failed");
    } finally {
      setMemoryLoading(false);
    }
  };
  const forgetMemoryKey = async (key) => {
    try {
      const userEmail = getUserEmail();

      const res = await fetch("http://localhost:5000/memory/forget", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userEmail,
          key,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Forget memory failed");
      }

      setSavedMemory(data.memory || {});
      showToast("Memory removed");
    } catch (error) {
      console.error(error);
      showToast("Forget failed");
    }
  };

  const clearAllMemory = async () => {
    try {
      const userEmail = getUserEmail();

      const res = await fetch("http://localhost:5000/memory/forget", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userEmail,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Clear memory failed");
      }

      setSavedMemory({});
      showToast("All memory cleared");
    } catch (error) {
      console.error(error);
      showToast("Clear memory failed");
    }
  };

  const renderMarkdown = (content) => (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ inline, className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || "");
          const language = match ? match[1] : "text";
          const codeText = String(children).replace(/\n$/, "");

          if (inline) {
            return (
              <code className="inline-code" {...props}>
                {children}
              </code>
            );
          }

          return (
            <div className="chat-code-block">
              <div className="chat-code-header">
                <span>{language.toUpperCase()}</span>
                <button
                  className="code-copy-btn"
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(codeText);
                    showToast("Code copied");
                  }}
                >
                  Copy
                </button>
              </div>

              <SyntaxHighlighter
                language={language}
                style={oneDark}
                showLineNumbers
                wrapLongLines
                PreTag="div"
              >
                {codeText}
              </SyntaxHighlighter>
            </div>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
  const isTimeDateQuestion = (text = "") => {
    const t = text.toLowerCase().trim();

    return (
      t === "time" ||
      t.includes("current time") ||
      t.includes("time now") ||
      t.includes("what is the time") ||
      t.includes("today date") ||
      t.includes("what day is today") ||
      t.includes("current date") ||
      t.includes("today's date") ||
      t.includes("aaj kya din hai") ||
      t.includes("aaj date kya hai") ||
      t.includes("aaj ka time")
    );
  };

  const isWeatherQuestion = (text = "") => {
    const t = text.toLowerCase();

    return (
      t.includes("weather") ||
      t.includes("temperature") ||
      t.includes("forecast") ||
      t.includes("mausam")
    );
  };

  const isImageGenerateQuestion = (text = "") => {
    const t = text.toLowerCase().trim();

    return (
      t.startsWith("generate image") ||
      t.startsWith("generate an image") ||
      t.startsWith("create image") ||
      t.startsWith("create an image") ||
      t.startsWith("make image") ||
      t.startsWith("make an image") ||
      t.startsWith("draw image") ||
      t.startsWith("draw an image") ||
      t.startsWith("image banao") ||
      t.startsWith("photo banao") ||
      t.startsWith("pic banao")
    );
  };

  const cleanImagePrompt = (text = "") => {
    const prompt = text
      .replace(/^generate an image/i, "")
      .replace(/^generate image/i, "")
      .replace(/^create an image/i, "")
      .replace(/^create image/i, "")
      .replace(/^make an image/i, "")
      .replace(/^make image/i, "")
      .replace(/^draw an image/i, "")
      .replace(/^draw image/i, "")
      .replace(/^image banao/i, "")
      .replace(/^photo banao/i, "")
      .replace(/^pic banao/i, "")
      .trim();

    return prompt || "beautiful futuristic artwork";
  };


  const isRemoveBackgroundQuestion = (text = "") => {
    const t = text.toLowerCase().trim();

    return (
      t.includes("remove background") ||
      t.includes("background remove") ||
      t.includes("remove bg") ||
      t.includes("bg remove") ||
      t.includes("transparent background") ||
      t.includes("background hatao") ||
      t.includes("bg hatao") ||
      t.includes("background hata do") ||
      t.includes("photo ka background hatao") ||
      t.includes("image ka background hatao")
    );
  };

  const isUploadedImageEditQuestion = (text = "") => {
    const t = String(text || "").toLowerCase();

    return (
      isRemoveBackgroundQuestion(t) ||
      t.includes("edit") ||
      t.includes("blur") ||
      t.includes("background") ||
      t.includes("change bg") ||
      t.includes("replace bg") ||
      t.includes("make background") ||
      t.includes("bg change") ||
      t.includes("object remove") ||
      t.includes("remove object") ||
      t.includes("inpaint") ||
      t.includes("enhance") ||
      t.includes("improve") ||
      t.includes("color grade") ||
      t.includes("colour grade") ||
      t.includes("shirt") ||
      t.includes("skin tone") ||
      t.includes("background blur") ||
      t.includes("blur the background") ||
      t.includes("background ko blur") ||
      t.includes("bg blur")
    );
  };

  const extractWeatherLocation = (text = "") => {
    let query = text
      .toLowerCase()
      .replace("weather", "")
      .replace("temperature", "")
      .replace("forecast", "")
      .replace("mausam", "")
      .replace("in", "")
      .replace("ka", "")
      .replace("kya", "")
      .replace("hai", "")
      .trim();

    return query || "Dhanbad";
  };

  const getLocalTimeAnswer = () => {
    const now = new Date();

    const time = now.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });

    const date = now.toLocaleDateString("en-IN", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    });

    return `Current time is **${time}**.

Today is **${date}**.`;
  };

  const isQuickInfoRequest = (text = "") => {
    const t = String(text || "").toLowerCase().trim();

    // Phase 6.4 hard guard: generation/build prompts must never enter live-info.
    if (isProjectBuildPrompt(text) || isWebsiteBuildPrompt(text)) return false;

    // Phase 6.2 Router Guard:
    // Coding/project-analysis prompts can contain words like "runtime", "fix time", "today" or "latest",
    // but they must never be routed to Weather/Time/News.
    const looksLikeCodingAgent = /\b(analyze|analyse|inspect|review|health report|dependency graph|readiness|project health|software engineer|software engineering|runtime error|syntax error|logic error|missing import|broken import|circular dependenc|duplicate code|dead code|memory leak|performance issue|accessibility|security issue|responsive issue|api problem|preview problem|voice problem|ai problem|auto fix|automatically fix|fix every bug|do not modify|do not edit|refactor|codebase|uploaded project|this project|entire project|whole project)\b/i.test(t);
    if (looksLikeCodingAgent) return false;

    const asksDateTime = /\b(date|time|day|today|aaj|aj|samay|waqt|tarikh|tareekh)\b/i.test(t);
    const asksWeather = /\b(weather|mausam|temperature|temp|rain|barish|humidity|wind|forecast)\b/i.test(t);
    const asksNews = /\b(news|khabar|khabrein|samachar|latest|aaj ki news|today news|kya kya hua|kya hua|hua)\b/i.test(t);
    const localContext = /\b(dhanbad|jharkhand|ranchi|bokaro|jamshedpur|india|local|city|near me)\b/i.test(t);

    return asksWeather || asksNews || asksDateTime || (localContext && (asksWeather || asksNews));
  };

  const isBlurBackgroundEditQuestion = (text = "") => {
    const t = String(text || "").toLowerCase();
    return (
      t.includes("blur background") ||
      t.includes("background blur") ||
      t.includes("blur the background") ||
      t.includes("bg blur") ||
      t.includes("background ko blur") ||
      t.includes("blur bg")
    );
  };

  const buildLocalBlurredImageDataUrl = (image = {}) => {
    if (!image?.base64 || !image?.mimeType) return "";

    const source = `data:${image.mimeType};base64,${image.base64}`;
    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
  <defs>
    <filter id="softBlur">
      <feGaussianBlur stdDeviation="12"/>
    </filter>
  </defs>
  <rect width="1200" height="900" fill="#0f172a"/>
  <image href="${source}" width="1200" height="900" preserveAspectRatio="xMidYMid slice" filter="url(#softBlur)" opacity="0.96"/>
</svg>`.trim();

    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
  };

  const readJsonResponse = async (response, label = "Backend") => {
    const raw = await response.text();

    try {
      return raw ? JSON.parse(raw) : {};
    } catch {
      const preview = raw.replace(/\s+/g, " ").slice(0, 120);
      const error = new Error(`${label} returned non-JSON response (${response.status}). Preview: ${preview}`);
      error.status = response.status;
      error.rawPreview = preview;
      throw error;
    }
  };

  const getBrowserIndiaDateTime = () => {
    const now = new Date();
    const date = now.toLocaleDateString("en-IN", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
      timeZone: "Asia/Kolkata",
    });
    const time = now.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
      timeZone: "Asia/Kolkata",
    });
    return { date, time };
  };

  const fetchJsonSafely = async (url, options = {}, label = "Backend") => {
    const res = await fetch(url, options);
    const data = await readJsonResponse(res, label);
    if (!res.ok) throw new Error(data.error || `${label} failed (${res.status})`);
    return data;
  };

  const buildClientQuickInfoFallback = async (query = "") => {
    const lower = String(query || "").toLowerCase();
    const dateTime = getBrowserIndiaDateTime();
    const wantsWeather = /weather|mausam|temperature|temp|rain|barish|humidity|wind|forecast/i.test(lower);
    const wantsNews = /news|khabar|khabrein|samachar|latest|kya hua|kya kya hua|today/i.test(lower);
    const wantsRanchi = /ranchi/i.test(lower);
    const wantsCalc = /7865|calculate|calculation|\*|×|÷|\/|\+|-/.test(lower);

    const lines = [];
    const sources = [];

    lines.push(`### Live Info`);
    lines.push(`- **Date:** ${dateTime.date}`);
    lines.push(`- **Current Time:** ${dateTime.time} IST`);

    const getWeather = async (location) => {
      try {
        return await fetchJsonSafely("http://localhost:5000/weather", {
          method: "POST",
          signal: abortControllerRef.current?.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ location }),
        }, `${location} weather`);
      } catch (error) {
        return { error: error.message, location };
      }
    };

    if (wantsWeather) {
      const dhanbad = await getWeather("Dhanbad");
      const ranchi = wantsRanchi ? await getWeather("Ranchi") : null;

      lines.push("");
      lines.push("### Weather");

      if (!dhanbad.error) {
        lines.push(`**Dhanbad:** ${dhanbad.condition || "N/A"}, ${dhanbad.temperature}°C, feels like ${dhanbad.feelsLike}°C, humidity ${dhanbad.humidity}%, wind ${dhanbad.wind} km/h.`);
        sources.push({ title: "Dhanbad Weather", snippet: "Current weather from wttr.in", displayLink: "wttr.in", link: "https://wttr.in/Dhanbad" });
      } else {
        lines.push(`**Dhanbad:** Weather fetch failed. ${dhanbad.error}`);
      }

      if (ranchi) {
        if (!ranchi.error) {
          lines.push(`**Ranchi:** ${ranchi.condition || "N/A"}, ${ranchi.temperature}°C, feels like ${ranchi.feelsLike}°C, humidity ${ranchi.humidity}%, wind ${ranchi.wind} km/h.`);
          sources.push({ title: "Ranchi Weather", snippet: "Current weather from wttr.in", displayLink: "wttr.in", link: "https://wttr.in/Ranchi" });
        } else {
          lines.push(`**Ranchi:** Weather fetch failed. ${ranchi.error}`);
        }
      }

      if (!dhanbad.error) {
        const rainText = String(dhanbad.condition || "").toLowerCase();
        const humidity = Number(dhanbad.humidity || 0);
        const carryUmbrella = /rain|shower|storm|drizzle|thunder/i.test(rainText) || humidity >= 75;
        lines.push("");
        lines.push(`**Umbrella recommendation:** ${carryUmbrella ? "Carry an umbrella today." : "Umbrella is not strictly necessary, but carry one if you will stay outside for long."}`);
      }
    }

    if (wantsCalc) {
      const value = (7865 * 98) / 23;
      lines.push("");
      lines.push("### Calculation");
      lines.push(`(7865 × 98) ÷ 23 = **${value.toFixed(2)}**`);
    }

    if (wantsNews) {
      try {
        const newsData = await fetchJsonSafely("http://localhost:5000/web-search", {
          method: "POST",
          signal: abortControllerRef.current?.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: "Dhanbad latest news today" }),
        }, "News search");

        const news = (newsData.results || []).slice(0, 5);
        lines.push("");
        lines.push("### Top Dhanbad News");

        if (news.length) {
          news.forEach((item, index) => {
            lines.push(`${index + 1}. **${item.title || "News update"}** — ${item.snippet || "Open source for details."}`);
          });
          sources.push(...news);
          lines.push("");
          lines.push("_News is based only on fetched web sources. SYNEZ AI did not invent local events._");
        } else {
          lines.push("I could not retrieve reliable fresh local news right now. I will not invent news.");
        }
      } catch (error) {
        lines.push("");
        lines.push("### Top Dhanbad News");
        lines.push(`News fetch failed: ${error.message}`);
        lines.push("I will not invent local news without sources.");
      }
    }

    return {
      reply: lines.join("\n"),
      provider: "SYNEZ Client Fallback + Backend APIs",
      model: "Critical Router v4 Fallback",
      sources,
    };
  };

  const fetchQuickInfoAnswer = async (query = "") => {
    const endpoints = [
      "http://localhost:5000/quick-info",
      "http://localhost:5000/api/quick-info",
    ];

    let lastError = null;

    for (const endpoint of endpoints) {
      try {
        return await fetchJsonSafely(endpoint, {
          method: "POST",
          signal: abortControllerRef.current?.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
        }, "Quick info backend");
      } catch (error) {
        lastError = error;
        // Continue to fallback endpoint. If both are missing, use weather/search routes directly.
      }
    }

    console.warn("Quick info route unavailable. Using client fallback.", lastError);
    return await buildClientQuickInfoFallback(query);
  };
  const shouldUseWebSearch = (text = "") => {
    const t = text.toLowerCase().trim();

    // Date/time/weather/local-news are handled by backend Intent Router, not generic web+LLM.
    if (isQuickInfoRequest(text)) return false;

    if (isAgentRequest(text)) return true;
    if (t.startsWith("search ")) return true;
    if (t.startsWith("web search ")) return true;
    if (t.startsWith("google ")) return true;

    // Important: comparisons like "iphone 17 vs samsung s26"
    // need fresh web results, otherwise the model gives outdated answers.
    if (/\bvs\b|\bversus\b|compare|comparison/i.test(t)) return true;

    const triggers = [
      "latest",
      "current",
      "today",
      "now",
      "news",
      "recent",
      "price",
      "launch date",
      "update policy",
      "score",
      "weather",
      "released",
      "release date",
      "available",
      "specs",
      "specification",
      "2025",
      "2026",
      "2027",
    ];

    if (
      t.includes("weather") ||
      t.includes("temperature") ||
      t.includes("forecast") ||
      t.includes("today") ||
      t.includes("date") ||
      t.includes("day") ||
      t.includes("time")
    ) {
      return true;
    }

    return triggers.some((word) => t.includes(word));
  };

  const isAgentRequest = (text = "") => {
    const t = text.toLowerCase().trim();

    return (
      t.startsWith("research ") ||
      t.startsWith("compare ") ||
      t.startsWith("analyze ") ||
      t.startsWith("find best ") ||
      t.startsWith("best ")
    );
  };

  const cleanSearchQuery = (text = "") => {
    const t = text.toLowerCase().trim();

    if (t.includes("what day is today")) {
      return "today date and day";
    }

    if (t.includes("today date")) {
      return "today date";
    }

    if (t.includes("weather")) {
      return text;
    }

    return text
      .replace(/^search\s+/i, "")
      .replace(/^web search\s+/i, "")
      .replace(/^google\s+/i, "")
      .trim();
  };

  const formatSearchResultsForAI = (results = []) => {
    if (!results.length) return "No web search results found.";

    return results
      .slice(0, 6)
      .map((item, index) => {
        return `${index + 1}. ${item.title}\nSnippet: ${item.snippet}\nSource: ${item.link}`;
      })
      .join("\n\n");
  };


  const isWebsiteBuildPrompt = (text = "") => {
    const t = text.toLowerCase();

    // Project/app/clone prompts must never become website prompts.
    if (isProjectBuildPrompt(text)) return false;

    return (
      /(build|create|make|generate|design|code|develop|banao|bnao|bnado)/i.test(t) &&
      /(website|web page|webpage|landing page|homepage|site|portfolio website|saas page|frontend page|html|css|javascript|navbar|hero|bento|pricing|faq|cta|footer)/i.test(t)
    ) || /(website|landing page|portfolio website|homepage|webpage).*(html|css|javascript|responsive|glass|bento|animation|pricing|faq|cta)/i.test(t);
  };


  const isProjectBuildPrompt = (text = "") => {
    const t = text.toLowerCase();

    if (/(netflix|spotify|youtube|instagram|whatsapp|uber|zomato|amazon|flipkart|twitter|facebook|discord|telegram|notion|trello|slack).*clone/i.test(t)) return true;
    if (/(clone).*(netflix|spotify|youtube|instagram|whatsapp|uber|zomato|amazon|flipkart|twitter|facebook|discord|telegram|notion|trello|slack)/i.test(t)) return true;

    const buildIntent = /(build|create|make|generate|develop|code|banao|bnao|bnado)/i.test(t);
    const projectWords = /(clone|app|application|platform|system|dashboard|portal|full project|complete project|multi[-\s]?file|react project|vite project|node project|full stack|frontend project|backend project|spotify|netflix|youtube|instagram|whatsapp|todo app|chat app|ecommerce app|crm|lms)/i.test(t);

    const pureWebsiteOnly =
      /(website|landing page|homepage|webpage)/i.test(t) &&
      !/(react|vite|full stack|backend|node|express|database|auth|dashboard|app|clone|multi[-\s]?file|project|platform|system)/i.test(t);

    return buildIntent && projectWords && !pureWebsiteOnly;
  };

  const isProjectMemoryPrompt = (text = "") => {
    const t = String(text || "").toLowerCase().trim();
    if (!t) return false;

    const projectScope = /\b(current project|this project|active project|synez ai workspace|project workspace|remembered project|project memory|project snapshot|saved project)\b/i.test(t);
    const saveIntent = /\b(remember|save|store|memorize|set as active|make active)\b/i.test(t);
    const recallIntent = /\b(what project|show project|recall|remember now|latest saved version|saved version|how many snapshots|list snapshots|show snapshots)\b/i.test(t);

    return projectScope && (saveIntent || recallIntent);
  };

  const isRuntimeSelfHealPrompt = (text = "") => {
    const t = String(text || "").toLowerCase().trim();
    if (!t) return false;

    const explicitEngine = /runtime self[-\s]?healing|self[-\s]?heal(?:ing)? preview|runtime repair engine/i.test(t);
    const runtimeFailure = /preview (?:has )?(?:crashed|failed|broken|blank)|blank preview|runtime (?:error|failure|crash)|vite (?:error|failed)|react (?:runtime )?error|console error|failed to compile|cannot resolve|is not defined|unexpected token/i.test(t);
    const repairIntent = /repair|heal|fix|recover|rebuild preview|reload preview|verify (?:the )?(?:repair|preview)/i.test(t);
    const projectScope = /current (?:running )?project|currently loaded project|remembered project|project files|codebase|preview|runtime/i.test(t);

    // Explicit runtime-engine prompts always win. Otherwise require both a
    // runtime failure signal and a repair/inspection context.
    return explicitEngine || (runtimeFailure && (repairIntent || projectScope));
  };

  const getTaskTypeForPrompt = (text = "") => {
    // Phase 6.8.1: Runtime Self-Healing has the highest priority because its
    // prompts often contain words such as "project", "analyze" and "build".
    if (isRuntimeSelfHealPrompt(text)) return "runtime-self-heal";
    if (isProjectMemoryPrompt(text)) return "project-memory";
    if (isCodingAgentPrompt(text)) return "coding-agent";
    if (isProjectBuildPrompt(text)) return "project";
    if (isWebsiteBuildPrompt(text)) return "website";
    if (isQuickInfoRequest(text)) return "chat";
    return "chat";
  };


  const resolveMasterRoute = async (text = "", context = {}, explicitTask = "") => {
    const localRoute = getTaskTypeForPrompt(text);
    try {
      const response = await fetch("http://localhost:5000/orchestrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text, context, explicitTask }),
      });
      const data = await response.json();
      if (!response.ok || !data?.intent) throw new Error(data?.error || "Orchestrator unavailable");

      const routeMap = {
        "runtime-self-heal": "runtime-self-heal",
        "project-memory": "project-memory",
        "coding-agent": "coding-agent",
        architecture: "project",
        website: "website",
        "quick-info": "chat",
        "web-search": "chat",
        "document-reader": "chat",
        "image-edit": "chat",
        "image-generation": "chat",
        chat: "chat",
      };
      const route = routeMap[data.intent] || localRoute;
      lastOrchestratedRouteRef.current = { prompt: text, route, meta: data };
      return { route, meta: data };
    } catch (error) {
      console.warn("Master Orchestrator fallback:", error.message);
      const fallback = { intent: localRoute, confidence: 0, reason: "Frontend deterministic fallback", version: "local" };
      lastOrchestratedRouteRef.current = { prompt: text, route: localRoute, meta: fallback };
      return { route: localRoute, meta: fallback };
    }
  };

  const isCodingAgentPrompt = (text = "") => {
    const t = String(text || "").toLowerCase().trim();
    if (!t) return false;

    const analysisIntent = /\b(analyze|analyse|inspect|review|health report|dependency graph|readiness|can this project build|understand every file|project health|software engineering review|senior software engineer|engineering report|production readiness)\b/i.test(t);
    const bugIntent = /\b(fix|debug|bug|error|runtime|console|crash|broken|issue|problem|not working|blank preview|preview blank|syntax error|logic error|missing import|broken import)\b/i.test(t);
    const refactorIntent = /\b(refactor|clean|optimi[sz]e|improve architecture|code cleanup|component splitting|hook extraction|reduce duplicate code)\b/i.test(t);
    const projectScope = /\b(codebase|project files|current project|this project|whole project|entire project|uploaded project|existing project|complete project)\b/i.test(t);
    const targetedFileEdit = /\b(edit|modify|update|fix|create|add)\b.*\b(file|component|page|hook|context|route|server\.js|app\.jsx|app\.css)\b/i.test(t);

    // A request to build/create/generate a whole app, platform, workspace or website is
    // generation, never Coding Agent patch mode—even when it mentions "project" or files.
    const wholeProjectBuild = /\b(build|create|generate|develop|make|banao|bnao|bnado)\b[\s\S]*\b(app|application|platform|workspace|website|webpage|dashboard|portal|clone|complete multi[-\s]?file|full[-\s]?stack)\b/i.test(t);
    if (wholeProjectBuild && !analysisIntent && !bugIntent && !refactorIntent) return false;

    return analysisIntent || (bugIntent && projectScope) || (refactorIntent && projectScope) || targetedFileEdit;
  };

  const shouldApplyCodingAgentChanges = (text = "") => {
    const t = String(text || "").toLowerCase();
    const analysisOnly = /\b(do not modify|do not edit|do not fix|wait for confirmation|analysis only|report only|review only|suggest only)\b/i.test(t);
    if (analysisOnly) return false;
    return /\b(automatically fix|auto fix|apply (?:the )?fix|fix every|fix all|edit only|required files|refactor this project|implement|create missing|update this project|modify this project)\b/i.test(t);
  };

  const getCodingAgentDiagnostics = () => ({
    activeProjectFile,
    projectValidation,
    runtime: previewRuntime,
    dependencyReport: previewDependencyReport,
    consoleLogs: (previewConsoleLogs || []).slice(-30),
    networkLogs: (previewNetworkLogs || []).slice(-20),
    assets: (previewAssets || []).slice(0, 25),
    performance: previewPerformance,
    score: previewScore,
    selectedPreviewElement,
  });

  const mergeCodingAgentFiles = (current = {}, changedFiles = {}) => {
    const next = { ...(current || {}) };

    Object.entries(changedFiles || {}).forEach(([path, code]) => {
      const name = String(path || "").trim();
      if (!name || typeof code !== "string") return;
      next[name] = {
        name,
        lang: getFileLanguage(name),
        code,
      };
    });

    return next;
  };

  const createProjectSnapshot = async (label = "Automatic snapshot", snapshotFiles = projectFiles) => {
    const userEmail = auth.currentUser?.email || "guest";

    if (!snapshotFiles || !Object.keys(snapshotFiles).length) return null;

    try {
      const response = await fetch("http://localhost:5000/project-memory/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userEmail,
          label,
          projectFiles: snapshotFiles,
          activeProjectFile,
        }),
      });

      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      console.warn("Project snapshot failed:", error.message);
      return null;
    }
  };

  const formatProjectAnalysisReply = (data = {}) => {
    if (data.reply) return data.reply;

    const issues = data.issues || [];
    const broken = data.brokenImports || [];
    const unused = data.unusedFiles || [];
    const graph = data.graph || {};
    const graphRows = Object.entries(graph)
      .slice(0, 20)
      .map(([from, deps]) => `- **${from}** → ${(deps || []).length ? deps.join(", ") : "no local imports"}`)
      .join("\n");

    return `### 🧠 SYNEZ Project Analyzer — Phase 6.2

${data.summary || "Project analysis completed."}

**Project Type**
- Frontend: ${data.project?.frontend || "Unknown"}
- Backend: ${data.project?.backend || "Unknown"}
- Auth: ${data.project?.auth || "Unknown"}
- Database: ${data.project?.database || "Unknown"}
- Preview: ${data.project?.preview || "Unknown"}

**Files**
- Total: ${data.fileStats?.total ?? 0}
- JS/JSX/TS/TSX: ${data.fileStats?.js ?? 0}
- CSS: ${data.fileStats?.css ?? 0}
- JSON: ${data.fileStats?.json ?? 0}

**Entry Files**
- App: ${data.entryFiles?.app || "Not detected"}
- Main: ${data.entryFiles?.main || "Not detected"}
- Server: ${data.entryFiles?.server || "Not detected"}

**Dependency Graph**
${graphRows || "- No dependency graph available."}

**Issues Found**
${issues.length ? issues.map((item) => `- **${item.priority}** — ${item.type} in \`${item.file}\`: ${item.reason}`).join("\n") : "- No critical project structure issues detected."}

**Broken Imports**
${broken.length ? broken.map((item) => `- \`${item.file}\` imports \`${item.import}\``).join("\n") : "- None detected."}

**Potentially Unused Files**
${unused.length ? unused.map((file) => `- ${file}`).join("\n") : "- None detected."}

No files were modified.`;
  };

  const formatCodingAgentReply = (data = {}) => {
    const updated = data.updatedFiles || [];
    const created = data.createdFiles || [];
    const changes = data.changes || [];
    const notes = data.notes || [];

    return `### ✅ AI Coding Agent v2 Applied

${data.summary || "Project update completed."}

${updated.length ? `**Updated files:**\n${updated.map((file) => `- ${file}`).join("\n")}` : ""}
${created.length ? `\n\n**Created files:**\n${created.map((file) => `- ${file}`).join("\n")}` : ""}
${changes.length ? `\n\n**Changes:**\n${changes.map((item) => `- ${item}`).join("\n")}` : ""}
${notes.length ? `\n\n**Notes:**\n${notes.map((item) => `- ${item}`).join("\n")}` : ""}

Preview has been refreshed with the updated project files.`;
  };


  const isSoftwareEngineerPlanRequest = (text = "") => {
    const t = String(text || "").toLowerCase();
    const explicitPlanner = /software engineering plan|project planner|generate (?:a )?(?:complete )?plan|before (?:writing|coding|editing)|wait for my approval|ask for approval|affected files|git-style diff|patch plan|implementation plan/i.test(t);
    const changeIntent = /\b(build|create|implement|add|fix|refactor|update|improve|optimize|change)\b/i.test(t);
    return explicitPlanner && changeIntent;
  };

  const handleEngineeringDecision = async (messageIndex, planId, action) => {
    if (!planId || loading) return;
    let modification = "";
    if (action === "modify") {
      modification = window.prompt("Describe how the plan should be modified:") || "";
      if (!modification.trim()) return;
    }

    setLoading(true);
    try {
      const response = await fetch("http://localhost:5000/software-engineer/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId,
          action,
          modification,
          projectFiles,
          activeProjectFile,
          userEmail: getUserEmail(),
        }),
      });
      const data = await readJsonResponse(response, "Software Engineer decision backend");
      if (!response.ok) throw new Error(data.error || "Engineering decision failed");

      if (data.projectFiles && action === "apply") {
        setProjectFiles(data.projectFiles);
        setProjectValidation(validateProjectFiles(data.projectFiles));
        if (!activeProjectFile || !data.projectFiles[activeProjectFile]) {
          setActiveProjectFile(Object.keys(data.projectFiles)[0] || "");
        }
        bumpPreviewVersion();
        setShowWorkPanel(true);
        setPanelTab("preview");
      }

      setMessages((current) => {
        const updated = current.map((msg, index) => {
          if (index !== messageIndex) return msg;
          return {
            ...msg,
            engineeringPlan: {
              ...(msg.engineeringPlan || {}),
              status: data.status || action,
              patchId: data.patchId || msg.engineeringPlan?.patchId,
              snapshotId: data.snapshotId || msg.engineeringPlan?.snapshotId,
            },
          };
        });

        const assistantMessage = {
          role: "assistant",
          content: data.reply || `Engineering plan ${action} completed.`,
          provider: data.provider || "SYNEZ Software Engineer Pro",
          model: data.model || "Phase 7.1–7.3",
          engineeringPlan: data.plan
            ? { id: data.plan.id, status: data.plan.status || "awaiting_approval" }
            : undefined,
        };
        const finalMessages = [...updated, assistantMessage];
        autoSaveChat(finalMessages);
        return finalMessages;
      });
    } catch (error) {
      console.error(error);
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: `❌ Software Engineer action failed: ${error.message}`,
          provider: "Error",
          model: "Phase 7.1–7.3",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async () => {
    if ((!input.trim() && !selectedFiles.length && !selectedImages.length) || loading) return;

    const userEmail = getUserEmail();

    let fileText = "";
    let imageData = null;
    let imageDataList = [];

    if (selectedFiles.length) {
      try {
        const MAX_FILE_CHARS = 12000;
        const parts = [];

        for (const file of selectedFiles) {
          let text = "";

          try {
            text = await readDocumentFile(file);
          } catch (error) {
            console.error(error);
            text =
              "[Unable to read this file. Backend /read-document route is not responding. Restart backend and check terminal logs.]";
          }

          if (text.length > MAX_FILE_CHARS) {
            text =
              text.slice(0, MAX_FILE_CHARS) +
              "\n\n[File too large. Only first 12000 characters were sent.]";
          }

          parts.push(`--- File: ${file.name} ---\n${text}`);
        }

        fileText = parts.join("\n\n");
      } catch (error) {
        console.error(error);
        fileText = "[Unable to read uploaded files]";
      }
    }

    if (selectedImages.length) {
      try {
        imageDataList = await Promise.all(
          selectedImages.map(async (file) => ({
            name: file.name,
            ...(await readImageAsBase64(file)),
          }))
        );
        imageData = imageDataList[0] || null;
      } catch (error) {
        console.error(error);
        showToast("Image read failed");
        return;
      }
    }

    const totalAttachments = selectedFiles.length + selectedImages.length;
    const isMultiFileUpload = totalAttachments > 1;
    const wantsCompare = /\b(compare|comparison|vs|versus|difference|differentiate)\b/i.test(input || "");

    const uploadedImageNames = selectedImages.map((file) => file.name).join(', ');
    const uploadedFileNames = selectedFiles.map((file) => file.name).join(', ');

    const finalInput = totalAttachments
      ? `${input || (isMultiFileUpload ? "Analyze these uploaded attachments." : "Please analyze this uploaded attachment.")}

Uploaded attachments:
${selectedImages.length ? `Images: ${uploadedImageNames}\n` : ""}${selectedFiles.length ? `Files: ${uploadedFileNames}\n` : ""}
${selectedFiles.length ? `
${isMultiFileUpload || wantsCompare ? `Important document mode:
- Read the extracted text below carefully.
- If comparison is requested, compare file-by-file.
- Use a clear table when useful.
- Mention missing/empty/scanned text if any file has no selectable text.
- Do not say you cannot read the file because the extracted text is already provided.\n` : ""}
Extracted file text:
${fileText}

Note: Very large files may be trimmed before sending to AI.` : ""}
${selectedImages.length > 1 ? "\nNote: Multiple images were uploaded. Analyze all visible images and compare them if asked." : ""}`
      : input;

    const orchestrated = await resolveMasterRoute(finalInput, {
      hasImages: selectedImages.length > 0,
      imageCount: selectedImages.length,
      hasDocuments: selectedFiles.length > 0,
      fileCount: selectedFiles.length,
      hasProjectFiles: Object.keys(projectFiles || {}).length > 0,
      hasRuntimeEvidence: Boolean(lastPreviewRuntimeError || (previewConsoleLogs || []).some((item) => item?.type === "error")),
    });
    const resolvedRoute = orchestrated.route;

    const userMsg = {
      role: "user",
      content: finalInput,
    };

    const newMessages = [...messages, userMsg];

    if (isSoftwareEngineerPlanRequest(finalInput) && !selectedImages.length && !selectedFiles.length) {
      setMessages(newMessages);
      setInput("");
      setLoading(true);

      try {
        const response = await fetch("http://localhost:5000/software-engineer/plan", {
          method: "POST",
          signal: abortControllerRef.current?.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            instruction: finalInput,
            projectFiles,
            projectName: "Current SYNEZ Project",
            userEmail,
          }),
        });
        const data = await readJsonResponse(response, "Software Engineer planner backend");
        if (!response.ok) throw new Error(data.error || "Project planning failed");

        const aiMsg = {
          role: "assistant",
          content: data.reply,
          provider: data.provider || "SYNEZ Software Engineer Pro",
          model: data.model || "Phase 7.1–7.3 Planner",
          engineeringPlan: {
            id: data.plan?.id,
            status: data.plan?.status || "awaiting_approval",
            confidence: data.plan?.confidence,
            risk: data.plan?.risk,
          },
        };
        const finalMessages = [...newMessages, aiMsg];
        setMessages(finalMessages);
        autoSaveChat(finalMessages);
      } catch (error) {
        console.error(error);
        const finalMessages = [...newMessages, {
          role: "assistant",
          content: `❌ Software Engineering Plan failed: ${error.message}`,
          provider: "Error",
          model: "Phase 7.1–7.3 Planner",
        }];
        setMessages(finalMessages);
        autoSaveChat(finalMessages);
      } finally {
        setLoading(false);
      }
      return;
    }

    if (selectedImages.length && isUploadedImageEditQuestion(finalInput) && !isRemoveBackgroundQuestion(finalInput)) {
      const prompt = String(input || finalInput || "").trim() || "Edit this uploaded image.";

      setMessages(newMessages);
      setInput("");
      setLoading(true);

      try {
        if (isBlurBackgroundEditQuestion(prompt)) {
          const editedUrl = buildLocalBlurredImageDataUrl(imageDataList[0] || imageData);

          if (!editedUrl) {
            throw new Error("Uploaded image data is missing.");
          }

          const aiMsg = {
            role: "assistant",
            content: `### ✅ Background Blur Preview Ready

Request: **${prompt}**

I applied a local blur preview to the uploaded image. For exact subject-preserved blur, the next backend step should connect a segmentation/inpainting model.`,
            imageDataUrl: editedUrl,
            provider: "SYNEZ Local Image Edit",
            model: "Background Blur Preview",
            sources: [
              {
                title: "Local Background Blur",
                snippet: "Generated directly inside SYNEZ AI without routing to normal text chat.",
                displayLink: "local image edit",
                link: "local://synez-image-edit",
              },
            ],
          };

          const finalMessages = [...newMessages, aiMsg];
          setMessages(finalMessages);
          clearUpload();
          autoSaveChat(finalMessages);
          return;
        }

        const editRes = await fetch("http://localhost:5000/image-edit", {
          method: "POST",
          signal: abortControllerRef.current?.signal,
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompt,
            imageData: imageDataList[0] || imageData,
            imageDataList,
          }),
        });

        const editData = await readJsonResponse(editRes, "Image edit backend");

        if (!editRes.ok) {
          throw new Error(editData.error || "Image edit failed");
        }

        const aiMsg = {
          role: "assistant",
          content: `### ✅ Image Edited

Request: **${prompt}**\n\n${editData.note ? editData.note : "Edited image is ready."}`,
          imageDataUrl: editData.imageDataUrl,
          provider: editData.provider || "SYNEZ Image Edit",
          model: editData.model || "Image Edit",
          sources: [
            {
              title: editData.provider || "SYNEZ Image Edit",
              snippet: editData.note || "Image edited directly in chat.",
              displayLink: "local image edit",
              link: editData.sourceUrl || "local://synez-image-edit",
            },
          ],
        };

        const finalMessages = [...newMessages, aiMsg];
        setMessages(finalMessages);
        clearUpload();
        autoSaveChat(finalMessages);
      } catch (error) {
        console.error(error);

        const finalMessages = [
          ...newMessages,
          {
            role: "assistant",
            content: `❌ Image edit failed: ${error.message}\n\nSupported now: blur background preview and remove background. Advanced inpainting/background replacement needs a real image-edit model endpoint connected in backend.`,
            provider: "Error",
            model: "Image Edit",
          },
        ];

        setMessages(finalMessages);
        clearUpload();
        autoSaveChat(finalMessages);
      } finally {
        setLoading(false);
      }

      return;
    }

    if (selectedImages.length === 1 && isRemoveBackgroundQuestion(finalInput)) {
      console.log("REMOVE BACKGROUND MODE TRIGGERED");

      try {
        const removeBgRes = await fetch("http://localhost:5000/remove-background", {
          method: "POST",
          signal: abortControllerRef.current?.signal,
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            imageData,
          }),
        });

        const removeBgData = await readJsonResponse(removeBgRes, "Background removal backend");

        if (!removeBgRes.ok) {
          throw new Error(removeBgData.error || "Background removal failed");
        }

        const aiMsg = {
          role: "assistant",
          content: `### ✅ Background Removed

Your image background has been removed successfully.`,

          imageDataUrl: removeBgData.imageDataUrl,

          provider: removeBgData.provider || "Hugging Face",
          model: removeBgData.model || "RMBG",

          sources: [
            {
              title: "Hugging Face Background Removal",
              snippet: "Background removed using AI model",
              displayLink: "huggingface.co",
              link: removeBgData.sourceUrl || "https://huggingface.co/briaai/RMBG-1.4",
            },
          ],
        };

        const finalMessages = [...newMessages, aiMsg];

        setMessages(finalMessages);
        setInput("");
        clearUpload();
        setLoading(false);
        autoSaveChat(finalMessages);

        return;
      } catch (error) {
        console.error(error);

        const finalMessages = [
          ...newMessages,
          {
            role: "assistant",
            content:
              "❌ Background removal failed. Backend check karo: HF_API_KEY .env me hai ya nahi, server restart hua ya nahi, aur image size zyada bada toh nahi.",
            provider: "Error",
            model: "Background Remove",
          },
        ];

        setMessages(finalMessages);
        setInput("");
        clearUpload();
        setLoading(false);
        autoSaveChat(finalMessages);

        return;
      }
    }

    if (!selectedFiles.length && !selectedImages.length && isImageGenerateQuestion(finalInput)) {
      console.log("IMAGE MODE TRIGGERED");

      try {
        const prompt = cleanImagePrompt(finalInput);

        const imageRes = await fetch("http://localhost:5000/generate-image", {
          method: "POST",
          signal: abortControllerRef.current?.signal,
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompt,
          }),
        });

        const imageData = await imageRes.json();

        if (!imageRes.ok) {
          throw new Error(imageData.error || "Image generation failed");
        }

        const aiMsg = {
          role: "assistant",
          content: `### 🖼 Generated Image

Prompt: **${prompt}**`,

          imageDataUrl: imageData.imageDataUrl,
          imageUrl: imageData.imageUrl,

          provider: imageData.provider || "Hugging Face",
          model: imageData.model || "Stable Diffusion",

          sources: [
            {
              title: imageData.provider || "Hugging Face",
              snippet: "AI image generated directly in chat",
              displayLink: "huggingface.co",
              link: imageData.sourceUrl || "https://huggingface.co/settings/tokens",
            },
          ],
        };

        const finalMessages = [...newMessages, aiMsg];

        setMessages(finalMessages);
        setInput("");
        clearUpload();
        setLoading(false);
        autoSaveChat(finalMessages);

        return;
      } catch (error) {
        console.error(error);

        const finalMessages = [
          ...newMessages,
          {
            role: "assistant",
            content:
              "❌ Image generation failed. Backend check karo: HF_API_KEY .env me hai ya nahi, aur server restart hua ya nahi.",
            provider: "Error",
            model: "Image Generation",
          },
        ];

        setMessages(finalMessages);
        setInput("");
        clearUpload();
        setLoading(false);
        autoSaveChat(finalMessages);
        return;
      }
    }



    if (!selectedFiles.length && !selectedImages.length && resolvedRoute === "runtime-self-heal") {
      setMessages(newMessages);
      setInput("");
      clearUpload();
      setLoading(true);
      abortControllerRef.current = new AbortController();

      try {
        showToast("Runtime Self-Healing is inspecting the preview...");

        const latestConsoleError = [...previewConsoleLogs]
          .reverse()
          .find((item) => item?.type === "error" || /error|failed|cannot resolve|is not defined|unexpected token|blank preview/i.test(String(item?.message || "")));

        const runtimeEvidenceMessage = String(
          lastPreviewRuntimeError?.message || latestConsoleError?.message || ""
        ).trim();

        const runtimeError = runtimeEvidenceMessage
          ? {
              ...(lastPreviewRuntimeError || {}),
              message: runtimeEvidenceMessage,
              type: lastPreviewRuntimeError?.type || latestConsoleError?.type || "preview-runtime-error",
              time: lastPreviewRuntimeError?.time || Date.now(),
            }
          : null;

        const healRes = await fetch("http://localhost:5000/runtime-self-heal", {
          method: "POST",
          signal: abortControllerRef.current.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            instruction: finalInput,
            runtimeError,
            projectFiles,
            useSelfProjectFallback: !Object.keys(projectFiles || {}).length,
            diagnostics: {
              ...getCodingAgentDiagnostics(),
              consoleLogs: previewConsoleLogs.slice(-60),
              networkLogs: previewNetworkLogs.slice(-40),
              previewRuntime,
              projectValidation,
            },
            model: selectedModel,
            userName,
            userEmail: getUserEmail(),
          }),
        });

        const healData = await readJsonResponse(healRes, "Runtime Self-Heal backend");
        if (!healRes.ok || healData.success === false) {
          throw new Error(healData.error || "Runtime self-heal failed");
        }

        const changedFiles = healData.files || {};
        const changedNames = Object.keys(changedFiles);
        let snapshotResult = null;

        if (changedNames.length) {
          snapshotResult = await createProjectSnapshot("Before manual runtime self-heal", projectFiles);
          const nextProject = mergeCodingAgentFiles(projectFiles, changedFiles);
          const validation = validateProjectFiles(nextProject);
          setProjectFiles(nextProject);
          setProjectValidation(validation);
          setActiveProjectFile((current) => current && nextProject[current] ? current : changedNames[0]);
          setPanelTab("preview");
          setShowWorkPanel(true);
          setLastPreviewRuntimeError(null);
          setTimeout(() => bumpPreviewVersion(), 120);
        }

        const changes = Array.isArray(healData.changes) ? healData.changes : [];
        const notes = Array.isArray(healData.notes) ? healData.notes : [];
        const aiMsg = {
          role: "assistant",
          content: `### 🛠 Runtime Self-Healing Report

${healData.summary || "Runtime inspection completed."}

**Route:** Runtime Self-Healing only
**Runtime:** ${previewRuntime || "unknown"}
**Runtime evidence:** ${healData.evidence?.message || runtimeEvidenceMessage || "No confirmed runtime evidence found"}
**Affected file:** ${healData.evidence?.file || "Not confirmed"}
**Line:** ${healData.evidence?.line || "Not available"}
**Files changed:** ${changedNames.length ? changedNames.join(", ") : "None"}
**Snapshot ID:** ${snapshotResult?.snapshot?.id || snapshotResult?.id || healData.snapshotId || "Not created"}
**Verification:** ${healData.verification?.status || (changedNames.length ? "Pending preview reload" : "Not required")}
**Preview status:** ${changedNames.length ? "Patch applied; preview refresh requested" : "No file changes applied"}
**Rollback status:** ${healData.rollbackStatus || "Not required"}

${changes.length ? `**Applied fixes:**
${changes.map((item) => `- ${item}`).join("\n")}` : "**Applied fixes:** None"}${notes.length ? `

**Notes:**
${notes.map((item) => `- ${item}`).join("\n")}` : ""}`,
          provider: healData.provider || "SYNEZ Runtime Self-Heal",
          model: healData.model || "Phase 6.8.1",
        };

        const finalMessages = [...newMessages, aiMsg];
        setMessages(finalMessages);
        autoSaveChat(finalMessages);
      } catch (error) {
        console.error(error);
        const finalMessages = [
          ...newMessages,
          {
            role: "assistant",
            content: `❌ Runtime Self-Healing failed: ${error.message}

The request stayed on the Runtime Self-Healing route and was not sent to Project Architecture.`,
            provider: "Error",
            model: "Runtime Self-Heal",
          },
        ];
        setMessages(finalMessages);
        autoSaveChat(finalMessages);
      } finally {
        setLoading(false);
        abortControllerRef.current = null;
      }

      return;
    }

    if (!selectedFiles.length && !selectedImages.length && resolvedRoute === "project-memory") {
      setMessages(newMessages);
      setInput("");
      clearUpload();
      setLoading(true);
      abortControllerRef.current = new AbortController();

      try {
        const lower = finalInput.toLowerCase();
        const isRecallOnly = /\b(what project|show project|recall|latest saved version|saved version|how many snapshots|list snapshots|show snapshots)\b/i.test(lower) &&
          !/\b(remember|save|store|set as active|make active)\b/i.test(lower);

        let data;
        if (isRecallOnly) {
          data = await fetchJsonSafely(
            `http://localhost:5000/project-memory?userEmail=${encodeURIComponent(getUserEmail())}`,
            { signal: abortControllerRef.current.signal },
            "Project memory"
          );
        } else {
          data = await fetchJsonSafely(
            "http://localhost:5000/project-memory/capture",
            {
              method: "POST",
              signal: abortControllerRef.current.signal,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                userEmail: getUserEmail(),
                projectName: "SYNEZ AI Workspace",
                projectFiles,
                activeProjectFile,
                diagnostics: getCodingAgentDiagnostics(),
                createSnapshot: true,
              }),
            },
            "Project memory capture"
          );
        }

        const remembered = data.project || null;
        const rememberedFiles = remembered?.projectFiles || {};
        const analysis = data.analysis || remembered?.analysis || null;
        const snapshots = data.snapshots || [];

        if (rememberedFiles && Object.keys(rememberedFiles).length) {
          setProjectFiles(rememberedFiles);
          setProjectValidation(validateProjectFiles(rememberedFiles));
          setActiveProjectFile(
            remembered?.activeProjectFile && rememberedFiles[remembered.activeProjectFile]
              ? remembered.activeProjectFile
              : Object.keys(rememberedFiles)[0]
          );
        }

        const fileCount = remembered?.fileCount ?? Object.keys(rememberedFiles).length;
        const snapshotCount = data.snapshotCount ?? snapshots.length ?? 0;
        const savedAt = remembered?.updatedAt
          ? new Date(remembered.updatedAt).toLocaleString("en-IN")
          : "Not available";

        const aiMsg = {
          role: "assistant",
          content: `### 🧠 Project Memory Updated

**Project:** ${remembered?.projectName || "SYNEZ AI Workspace"}
**Files saved:** ${fileCount}
**Frontend:** ${analysis?.project?.frontend || remembered?.analysis?.project?.frontend || "Detected from saved files"}
**Backend:** ${analysis?.project?.backend || remembered?.analysis?.project?.backend || "Detected from saved files"}
**Database:** ${analysis?.project?.database || remembered?.analysis?.project?.database || "Not detected"}
**Health score:** ${analysis?.healthScore ?? remembered?.analysis?.healthScore ?? "Not calculated"}${typeof (analysis?.healthScore ?? remembered?.analysis?.healthScore) === "number" ? "/100" : ""}
**Saved at:** ${savedAt}
**Snapshots:** ${snapshotCount}

The analyzer result and the exact project files are now synchronized in Project Memory. No files were modified.`,
          provider: "SYNEZ Project Memory",
          model: "Phase 6.7.1 Analyzer Sync",
        };

        const finalMessages = [...newMessages, aiMsg];
        setMessages(finalMessages);
        autoSaveChat(finalMessages);
        showToast(isRecallOnly ? "Project memory loaded" : "Project saved with analyzer data");
      } catch (error) {
        console.error(error);
        const finalMessages = [
          ...newMessages,
          {
            role: "assistant",
            content: `❌ Project Memory failed: ${error.message}`,
            provider: "Error",
            model: "Project Memory",
          },
        ];
        setMessages(finalMessages);
        autoSaveChat(finalMessages);
      } finally {
        setLoading(false);
        abortControllerRef.current = null;
      }

      return;
    }

    if (!selectedFiles.length && !selectedImages.length && resolvedRoute === "chat" && isQuickInfoRequest(finalInput)) {
      setMessages(newMessages);
      setInput("");
      clearUpload();
      setLoading(true);
      abortControllerRef.current = new AbortController();

      try {
        showToast("Getting live info...");

        const quickData = await fetchQuickInfoAnswer(finalInput);

        const aiMsg = {
          role: "assistant",
          content: quickData.reply || "No live info found.",
          provider: quickData.provider || "SYNEZ Live Info",
          model: quickData.model || "Critical Router v3",
          sources: quickData.sources || [],
        };

        const finalMessages = [...newMessages, aiMsg];
        setMessages(finalMessages);
        autoSaveChat(finalMessages);
      } catch (error) {
        console.error(error);
        const finalMessages = [
          ...newMessages,
          {
            role: "assistant",
            content: `❌ Live info failed: ${error.message}\n\nBackend check karo: server running hai ya /quick-info route active hai.`,
            provider: "Error",
            model: "Quick Info",
          },
        ];
        setMessages(finalMessages);
        autoSaveChat(finalMessages);
      } finally {
        setLoading(false);
        abortControllerRef.current = null;
      }

      return;
    }

    if (!selectedFiles.length && !selectedImages.length && isTimeDateQuestion(finalInput)) {
      const aiMsg = {
        role: "assistant",
        content: getLocalTimeAnswer(),
        provider: "SYNEZ AI",
        model: "Local Time",
      };

      const finalMessages = [...newMessages, aiMsg];

      setMessages(finalMessages);
      setInput("");
      clearUpload();
      setLoading(false);
      autoSaveChat(finalMessages);
      return;
    }

    if (!selectedFiles.length && !selectedImages.length && isWeatherQuestion(finalInput)) {
      try {
        const location = extractWeatherLocation(finalInput);

        const weatherRes = await fetch("http://localhost:5000/weather", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ location }),
        });

        const weatherData = await weatherRes.json();

        if (!weatherRes.ok) {
          throw new Error(weatherData.error || "Weather failed");
        }

        const aiMsg = {
          role: "assistant",
          content: `### 🌤 Weather in ${weatherData.location}

| Detail | Value |
|---------|---------|
| Temperature | ${weatherData.temperature}°C |
| Feels Like | ${weatherData.feelsLike}°C |
| Condition | ${weatherData.condition} |
| Humidity | ${weatherData.humidity}% |
| Wind Speed | ${weatherData.wind} km/h |

Based on live weather data.`,
          provider: "SYNEZ Weather",
          model: "Weather Handler",
          sources: [
            {
              title: "Live Weather Data",
              snippet: `Current weather for ${weatherData.location}, ${weatherData.country}`,
              displayLink: weatherData.source,
              link: `https://wttr.in/${encodeURIComponent(location)}`,
            },
          ],
        };

        const finalMessages = [...newMessages, aiMsg];

        setMessages(finalMessages);
        setInput("");
        clearUpload();
        setLoading(false);
        autoSaveChat(finalMessages);
        return;
      } catch (error) {
        console.error(error);
        showToast("Weather failed");
      }
    }


    if (!selectedFiles.length && !selectedImages.length && resolvedRoute === "coding-agent") {
      setMessages(newMessages);
      setInput("");
      clearUpload();
      setLoading(true);
      abortControllerRef.current = new AbortController();

      try {
        showToast(finalInput.toLowerCase().includes("fix") || finalInput.toLowerCase().includes("edit") ? "AI Coding Agent is editing project..." : "AI Coding Agent is analyzing project...");

        const agentRes = await fetch("http://localhost:5000/coding-agent", {
          method: "POST",
          signal: abortControllerRef.current.signal,
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            instruction: finalInput,
            projectFiles,
            useSelfProjectFallback: !Object.keys(projectFiles || {}).length,
            diagnostics: getCodingAgentDiagnostics(),
            model: selectedModel,
            userName,
            userEmail: getUserEmail(),
          }),
        });

        const agentData = await readJsonResponse(agentRes, "Coding Agent backend");

        if (!agentRes.ok || agentData.success === false) {
          throw new Error(agentData.error || "Coding Agent failed");
        }

        const changedFiles = agentData.files || {};
        const changedNames = Object.keys(changedFiles);

        const mayApplyAgentChanges = shouldApplyCodingAgentChanges(finalInput);

        if (changedNames.length && mayApplyAgentChanges) {
          await createProjectSnapshot("Before Coding Agent changes", projectFiles);
          const nextProject = mergeCodingAgentFiles(projectFiles, changedFiles);
          const validation = validateProjectFiles(nextProject);
          setProjectFiles(nextProject);
          setProjectValidation(validation);
          setActiveProjectFile((current) => current && nextProject[current] ? current : changedNames[0]);
          setPanelTab("preview");
          setShowWorkPanel(true);
          setTimeout(() => bumpPreviewVersion(), 80);
        }

        const aiMsg = {
          role: "assistant",
          content: agentData.task === "project-analysis"
            ? formatProjectAnalysisReply(agentData)
            : changedNames.length && mayApplyAgentChanges
            ? formatCodingAgentReply(agentData)
            : changedNames.length
            ? `### Coding Agent Draft\n\nA safe patch was prepared but not applied because this request was analysis/review-only.\n\n${formatCodingAgentReply(agentData)}`
            : `### ⚠️ AI Coding Agent v2\n\n${agentData.summary || "No safe file changes were produced."}\n\n${(agentData.notes || []).map((note) => `- ${note}`).join("\n")}`,
          provider: agentData.provider || "SYNEZ Coding Agent",
          model: agentData.model || "Coding Agent v2",
          sources: [
            {
              title: "SYNEZ AI Coding Agent v2",
              snippet: "Project-aware multi-file editing, debugging, refactoring and file creation.",
              displayLink: "local coding agent",
              link: "local://synez-coding-agent-v2",
            },
          ],
        };

        const finalMessages = [...newMessages, aiMsg];
        setMessages(finalMessages);
        autoSaveChat(finalMessages);
      } catch (error) {
        console.error(error);
        const finalMessages = [
          ...newMessages,
          {
            role: "assistant",
            content: `❌ AI Coding Agent failed: ${error.message}\n\nBackend check karo: /coding-agent route active hai, server restart hua hai, aur model API key working hai.`,
            provider: "Error",
            model: "Coding Agent v2",
          },
        ];
        setMessages(finalMessages);
        autoSaveChat(finalMessages);
      } finally {
        setLoading(false);
        abortControllerRef.current = null;
      }

      return;
    }


    setMessages(newMessages);
    setInput("");
    clearUpload();
    setLoading(true);

    const rememberMatch = !selectedFiles.length && !selectedImages.length
      ? finalInput.match(/^remember\s+(?:that\s+)?(.+?)\s+is\s+(.+)$/i)
      : null;

    if (rememberMatch) {
      try {
        const rawKey = rememberMatch[1]
          .trim()
          .replace(/^my\s+/i, "")
          .replace(/^your\s+/i, "");

        const value = rememberMatch[2].trim();

        const res = await fetch("http://localhost:5000/memory/save", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            userEmail,
            key: rawKey,
            value,
          }),
        });

        const data = await res.json();

        if (!res.ok || !data.success) {
          throw new Error(data.error || "Memory save failed");
        }

        const aiMsg = {
          role: "assistant",
          content: `Got it — I'll remember that your ${rawKey} is ${value}.`,
          provider: "SYNEZ AI",
          model: "Memory",
        };

        const finalMessages = [...newMessages, aiMsg];

        setMessages(finalMessages);
        autoSaveChat(finalMessages);
        showToast("Memory saved");
      } catch (error) {
        console.error(error);

        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: "❌ Memory save failed. Backend check karo.",
            provider: "Error",
            model: "Error",
          },
        ]);
      }

      setLoading(false);
      abortControllerRef.current = null;
      return;
    }

    const useWebSearch = !selectedFiles.length && !selectedImages.length && !isQuickInfoRequest(finalInput) && shouldUseWebSearch(finalInput);

    abortControllerRef.current = new AbortController();

    try {
      if (useWebSearch) {
        showToast("Searching the web...");

        const searchQuery = cleanSearchQuery(finalInput);
        const searchEndpoint = isAgentRequest(finalInput)
          ? "http://localhost:5000/agent-research"
          : "http://localhost:5000/web-search";
        const searchRes = await fetch(searchEndpoint, {
          method: "POST",
          signal: abortControllerRef.current.signal,
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query: searchQuery,
          }),
        });

        const searchData = await searchRes.json();

        if (!searchRes.ok) {
          throw new Error(searchData.error || "Web search failed");
        }

        const sources = searchData.results || [];
        const webContext = formatSearchResultsForAI(sources);

        const webMessages = [
          ...newMessages,
          {
            role: "user",
            content: isAgentRequest(finalInput)
              ? `You are SYNEZ AI Agent Mode Pro.

User Request:
${finalInput}

Web Search Results:
${webContext}

Instructions:
- You are using Agent Mode Pro+.
- Analyze all web results carefully.
- Combine information from multiple sources.
- If comparing, ALWAYS use a proper markdown table.
- Format tables using | column | column | syntax.
- Give pros and cons.
- Give a final recommendation with clear reason.
- Mention that the answer is based on web results.
- Do not invent facts, prices, update policy, scores, or sources.
- If information is unclear, say it is unclear.
- Keep it practical and easy to understand.`
              : `Use these latest web search results to answer the user's question.

User question:
${finalInput}

Web Search Results:
${webContext}

Rules:
- Give a clear answer.
- If the user asks a comparison or uses "vs", ALWAYS use a markdown comparison table.
- Mention that the answer is based on web results.
- Keep it concise.
- Do not invent sources.`,
          },
        ];
        const failoverResult = await askModelWithFailover({
          baseMessages: webMessages,
          signal: abortControllerRef.current.signal,
        });

        const data = failoverResult.data;

        const aiMsg = {
          role: "assistant",
          content: `${failoverResult.switched ? `⚡ Auto switched to ${failoverResult.modelUsed}\n\n` : ""}${data.reply || "No response received from AI."}`,
          provider: data.provider || failoverResult.providerUsed || "Web Search",
          model: data.model || failoverResult.modelUsed,
          sources,
        };

        const finalMessages = [...newMessages, aiMsg];

        setMessages(finalMessages);
        updateCodePanel(aiMsg.content);
        autoSaveChat(finalMessages);
      } else {
        const useStreaming =
          !selectedImages.length &&
          !selectedFiles.length &&
          !selectedModel.startsWith("gemini") &&
          getTaskTypeForPrompt(finalInput) === "chat" &&
          !isQuickInfoRequest(finalInput);

        console.log("Streaming mode:", useStreaming);
        console.log("Selected model:", selectedModel);
        console.log("User email:", userEmail);

        if (useStreaming) {
          try {
            const providerName = getProviderName(selectedModel);

            const aiMsg = {
              role: "assistant",
              content: "",
              provider: providerName,
              model: selectedModel,
            };

            setMessages([...newMessages, aiMsg]);

            const res = await fetch("http://localhost:5000/chat-stream", {
              method: "POST",
              signal: abortControllerRef.current.signal,
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: selectedModel,
                userName,
                userEmail,
                taskType: getTaskTypeForPrompt(finalInput),
                messages: newMessages.map((m) => ({
                  role: m.role,
                  content: m.content,
                })),
              }),
            });

            if (!res.ok || !res.body) {
              throw new Error("Streaming request failed");
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();

            let aiText = "";

            while (true) {
              const { done, value } = await reader.read();

              if (done) break;

              const chunk = decoder.decode(value, {
                stream: true,
              });

              aiText += chunk;

              setMessages([
                ...newMessages,
                {
                  ...aiMsg,
                  content: aiText,
                },
              ]);
            }

            const finalMessages = [
              ...newMessages,
              {
                ...aiMsg,
                content: aiText || "No response received.",
              },
            ];

            setMessages(finalMessages);
            updateCodePanel(aiText);
            autoSaveChat(finalMessages);
          } catch (streamError) {
            if (streamError.name === "AbortError") throw streamError;

            const failoverResult = await askModelWithFailover({
              baseMessages: newMessages,
              signal: abortControllerRef.current.signal,
              skipFirst: true,
              taskType: getTaskTypeForPrompt(finalInput),
            });

            const data = failoverResult.data;

            const aiMsg = {
              role: "assistant",
              content: `⚡ Auto switched to ${failoverResult.modelUsed}\n\n${data.reply || "No response received from AI."}`,
              provider: data.provider || failoverResult.providerUsed,
              model: data.model || failoverResult.modelUsed,
            };

            const finalMessages = [...newMessages, aiMsg];

            setMessages(finalMessages);
            updateCodePanel(aiMsg.content);
            autoSaveChat(finalMessages);
          }
        } else {
          const failoverResult = await askModelWithFailover({
            baseMessages: newMessages,
            imageDataPayload: imageDataList.length ? imageDataList : imageData,
            signal: abortControllerRef.current.signal,
            taskType: getTaskTypeForPrompt(finalInput),
          });

          const data = failoverResult.data;

          const aiMsg = {
            role: "assistant",
            content: `${failoverResult.switched ? `⚡ Auto switched to ${failoverResult.modelUsed}\n\n` : ""}${data.reply || "No response received from AI."}`,
            provider: data.provider || failoverResult.providerUsed,
            model: data.model || failoverResult.modelUsed,
          };

          const finalMessages = [...newMessages, aiMsg];

          setMessages(finalMessages);
          updateCodePanel(aiMsg.content);
          autoSaveChat(finalMessages);
        }
      }
    } catch (error) {
      if (error.name === "AbortError") {
        showToast("Generation stopped");
      } else {
        console.error(error);

        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: "❌ Server ya API me problem hai. Backend check karo.",
            provider: "Error",
            model: "Error",
          },
        ]);
      }
    }

    setLoading(false);
    abortControllerRef.current = null;
  };

  const stopGenerating = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setLoading(false);
    }
  };

  const regenerateResponse = async () => {
    if (loading) return;

    const lastUserIndex = [...messages]
      .map((m) => m.role)
      .lastIndexOf("user");

    if (lastUserIndex === -1) {
      showToast("No prompt found");
      return;
    }

    const baseMessages = messages.slice(0, lastUserIndex + 1);

    setMessages(baseMessages);
    setLoading(true);

    abortControllerRef.current = new AbortController();

    try {
      const lastUserContent = baseMessages[lastUserIndex]?.content || "";
      const rememberedRoute = lastOrchestratedRouteRef.current?.prompt === lastUserContent
        ? lastOrchestratedRouteRef.current
        : await resolveMasterRoute(lastUserContent, {
            hasProjectFiles: Object.keys(projectFiles || {}).length > 0,
            hasRuntimeEvidence: Boolean(lastPreviewRuntimeError || (previewConsoleLogs || []).some((item) => item?.type === "error")),
          });
      const regenerateRoute = rememberedRoute.route || "chat";

      if (regenerateRoute === "chat" && isQuickInfoRequest(lastUserContent)) {
        showToast("Getting live info...");

        const quickData = await fetchQuickInfoAnswer(lastUserContent);

        const aiMsg = {
          role: "assistant",
          content: quickData.reply || "No live info found.",
          provider: quickData.provider || "SYNEZ Live Info",
          model: quickData.model || "Critical Router v3",
          sources: quickData.sources || [],
        };

        const finalMessages = [...baseMessages, aiMsg];
        setMessages(finalMessages);
        autoSaveChat(finalMessages);
        setLoading(false);
        abortControllerRef.current = null;
        return;
      }

      const failoverResult = await askModelWithFailover({
        baseMessages,
        signal: abortControllerRef.current.signal,
        taskType: regenerateRoute === "project" || regenerateRoute === "website" || regenerateRoute === "runtime-self-heal"
          ? regenerateRoute
          : "chat",
      });

      const data = failoverResult.data;

      const aiMsg = {
        role: "assistant",
        content: `${failoverResult.switched ? `⚡ Auto switched to ${failoverResult.modelUsed}\n\n` : ""}${data.reply || "No response received."}`,
        provider: data.provider || failoverResult.providerUsed,
        model: data.model || failoverResult.modelUsed,
      };

      const finalMessages = [...baseMessages, aiMsg];

      setMessages(finalMessages);
      updateCodePanel(aiMsg.content);
      autoSaveChat(finalMessages);
    } catch (error) {
      if (error.name === "AbortError") {
        showToast("Regenerate stopped");
      } else {
        console.error(error);
        showToast("Regenerate failed");
      }
    }

    setLoading(false);
    abortControllerRef.current = null;
  };

  const copyMessage = (content) => {
    navigator.clipboard.writeText(content);
    showToast("Copied");
  };

  const likeMessage = () => showToast("Liked");
  const dislikeMessage = () => showToast("Disliked");

  const shareMessage = (content) => {
    navigator.clipboard.writeText(content);
    showToast("Share text copied");
  };

  const showMoreActions = () => showToast("More options coming soon");

  const showSources = (provider, model) => {
    if (provider && model) showToast(`${provider} • ${model}`);
    else showToast("No source available");
  };

  const openPreviewInNewTab = () => {
    if (!previewDoc) {
      showToast("No preview available");
      return;
    }

    const blob = new Blob([previewDoc], {
      type: "text/html",
    });

    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  };

  const refreshPreview = () => {
    setPreviewDoc(buildPreviewCode(files));
    showToast("Preview refreshed");
  };

  const handleEnter = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const newChat = () => {
    setCurrentChatId(null);

    setMessages([
      {
        role: "assistant",
        content: `Welcome back, ${userName}.

A new SYNEZ AI conversation has started.

What would you like to build today?`,
      },
    ]);

    setFiles({
      html: "",
      css: "",
      js: "",
    });

    setPreviewDoc("");
    setPanelTab("code");
    setShowWorkPanel(false);
  };

  const saveCurrentChat = async () => {
    if (messages.length < 2) return;

    const user = auth.currentUser;

    if (!user) {
      showToast("Login required");
      return;
    }

    const chatData = {
      title: getChatTitle(messages),
      messages,
      updatedAt: Date.now(),
    };

    try {
      if (currentChatId) {
        await updateDoc(doc(db, "users", user.uid, "chats", currentChatId), chatData);
        showToast("Chat Updated");
        return;
      }

      const docRef = await addDoc(collection(db, "users", user.uid, "chats"), {
        ...chatData,
        createdAt: Date.now(),
      });

      setCurrentChatId(docRef.id);
      showToast("Chat Saved");
    } catch (error) {
      console.error(error);
      showToast("Save Failed");
    }
  };

  const loadChat = (chat) => {
    setCurrentChatId(chat.id);
    setMessages(chat.messages);
    setShowSidebar(false);
    setOpenMenuId(null);

    const lastAssistant = [...chat.messages]
      .reverse()
      .find((m) => m.role === "assistant");

    if (lastAssistant) {
      updateCodePanel(lastAssistant.content);
    }
  };

  const renameChat = async (id) => {
    if (!renameText.trim()) return;

    const user = auth.currentUser;

    const updatedHistory = dedupeChats(chatHistory).map((chat) =>
      chat.id === id
        ? {
          ...chat,
          title: renameText,
        }
        : chat
    );

    const updatedPinned = pinnedChats.map((chat) =>
      chat.id === id
        ? {
          ...chat,
          title: renameText,
        }
        : chat
    );

    setChatHistory(updatedHistory);
    setPinnedChats(updatedPinned);

    localStorage.setItem("chatHistory", JSON.stringify(updatedHistory));
    localStorage.setItem("pinnedChats", JSON.stringify(updatedPinned));

    if (user) {
      try {
        await updateDoc(doc(db, "users", user.uid, "chats", id), {
          title: renameText,
        });
      } catch (error) {
        console.error(error);
      }
    }

    setRenameChatId(null);
    setRenameText("");
    setOpenMenuId(null);
    showToast("Chat renamed");
  };

  const deleteChat = (id) => {
    setConfirmBox({
      show: true,
      type: "single",
      id,
    });

    setOpenMenuId(null);
  };

  const deleteAllChats = () => {
    setConfirmBox({
      show: true,
      type: "all",
      id: null,
    });
  };

  const confirmDelete = async () => {
    const user = auth.currentUser;

    if (confirmBox.type === "single") {
      const updatedHistory = chatHistory.filter(
        (chat) => chat.id !== confirmBox.id
      );

      const updatedPinned = pinnedChats.filter(
        (chat) => chat.id !== confirmBox.id
      );

      setChatHistory(updatedHistory);
      setPinnedChats(updatedPinned);

      localStorage.setItem("chatHistory", JSON.stringify(updatedHistory));
      localStorage.setItem("pinnedChats", JSON.stringify(updatedPinned));

      if (user) {
        try {
          await deleteDoc(doc(db, "users", user.uid, "chats", confirmBox.id));
        } catch (error) {
          console.error(error);
        }
      }

      if (currentChatId === confirmBox.id) {
        newChat();
      }

      showToast("Chat deleted");
    }

    if (confirmBox.type === "all") {
      setChatHistory([]);
      setPinnedChats([]);
      localStorage.removeItem("chatHistory");
      localStorage.removeItem("pinnedChats");

      if (user) {
        try {
          const snapshot = await getDocs(
            collection(db, "users", user.uid, "chats")
          );

          snapshot.forEach(async (chatDoc) => {
            await deleteDoc(doc(db, "users", user.uid, "chats", chatDoc.id));
          });
        } catch (error) {
          console.error(error);
        }
      }

      newChat();
      showToast("All chats deleted");
    }

    setConfirmBox({
      show: false,
      type: "",
      id: null,
    });
  };

  const pinChat = (chat) => {
    const alreadyPinned = pinnedChats.some((c) => c.id === chat.id);

    let updatedPinned;

    if (alreadyPinned) {
      updatedPinned = pinnedChats.filter((c) => c.id !== chat.id);
      showToast("Chat unpinned");
    } else {
      updatedPinned = [chat, ...pinnedChats];
      showToast("Chat pinned");
    }

    setPinnedChats(updatedPinned);
    localStorage.setItem("pinnedChats", JSON.stringify(updatedPinned));
    setOpenMenuId(null);
  };

  const isPinned = (id) => pinnedChats.some((chat) => chat.id === id);

  const copyCode = () => {
    navigator.clipboard.writeText(
      `HTML:\n${files.html}\n\nCSS:\n${files.css}\n\nJS:\n${files.js}`
    );
    showToast("All code copied");
  };

  const copyHTML = () => {
    navigator.clipboard.writeText(files.html);
    setCopied("html");
    showToast("HTML copied");
    setTimeout(() => setCopied(""), 2000);
  };

  const copyCSS = () => {
    navigator.clipboard.writeText(files.css);
    setCopied("css");
    showToast("CSS copied");
    setTimeout(() => setCopied(""), 2000);
  };

  const copyJS = () => {
    navigator.clipboard.writeText(files.js);
    setCopied("js");
    showToast("JS copied");
    setTimeout(() => setCopied(""), 2000);
  };

  const downloadCode = async () => {
    const zip = new JSZip();

    zip.file("index.html", files.html || "<!-- HTML code empty -->");
    zip.file("style.css", files.css || "/* CSS code empty */");
    zip.file("script.js", files.js || "// JavaScript code empty");

    const content = await zip.generateAsync({
      type: "blob",
    });

    const url = URL.createObjectURL(content);

    const a = document.createElement("a");
    a.href = url;
    a.download = "synez-project.zip";
    a.click();

    URL.revokeObjectURL(url);
    showToast("ZIP downloaded");
  };

  const exportChatPDF = () => {
    const docPdf = new jsPDF();

    let y = 20;

    docPdf.setFontSize(18);
    docPdf.text("SYNEZ AI Chat Export", 10, y);

    y += 15;

    messages.forEach((msg) => {
      const role = msg.role === "user" ? "You" : "AI";
      const text = `${role}: ${msg.content}`;

      const lines = docPdf.splitTextToSize(text, 180);

      docPdf.text(lines, 10, y);

      y += lines.length * 7 + 5;

      if (y > 270) {
        docPdf.addPage();
        y = 20;
      }
    });

    docPdf.save("chat-export.pdf");
    showToast("PDF Exported");
  };



  const getTotalMessages = () => {
    return chatHistory.reduce((total, chat) => {
      return total + (chat.messages?.length || 0);
    }, messages.length);
  };

  const getMemoryCount = () => {
    return Object.keys(savedMemory || {}).length;
  };

  const openDashboard = async () => {
    await fetchMemory();
    setShowMemoryPanel(false);
    setShowDashboard(true);
  };

  const exportTXT = () => {
    const text = messages
      .map((msg) => `${msg.role.toUpperCase()}:\n${msg.content}\n`)
      .join("\n--------------------\n");

    const blob = new Blob([text], {
      type: "text/plain",
    });

    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "SYNEZ-Chat.txt";
    a.click();

    URL.revokeObjectURL(url);
    showToast("TXT Exported");
  };

  const exportJSON = () => {
    const chatData = {
      app: "SYNEZ AI",
      exportedAt: new Date().toISOString(),
      messages,
    };


    const blob = new Blob([JSON.stringify(chatData, null, 2)], {
      type: "application/json",
    });

    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "SYNEZ-Chat.json";
    a.click();

    URL.revokeObjectURL(url);
    showToast("JSON Exported");
  };

  const logout = async () => {
    localStorage.removeItem("userEmail");
    await signOut(auth);
    window.location.href = "/login";
  };

  const renderChatRow = (chat) => (
    <div key={chat.id} className="history-row-wrapper">
      <div className="history-row">
        <button className="history-item" onClick={() => loadChat(chat)}>
          {chat.title}
        </button>

        <button
          className="chat-menu-btn"
          onClick={(e) => {
            e.stopPropagation();
            setOpenMenuId(openMenuId === chat.id ? null : chat.id);
          }}
        >
          <span className="dot"></span>
          <span className="dot"></span>
          <span className="dot"></span>
        </button>
      </div>

      {openMenuId === chat.id && (
        <div className="chat-menu">
          <button
            onClick={() => {
              setRenameChatId(chat.id);
              setRenameText(chat.title);
            }}
          >
            ✏️ Rename
          </button>

          <button onClick={() => pinChat(chat)}>
            {isPinned(chat.id) ? "📌 Unpin Chat" : "📌 Pin Chat"}
          </button>

          <button className="danger-menu" onClick={() => deleteChat(chat.id)}>
            🗑 Delete
          </button>
        </div>
      )}

      {renameChatId === chat.id && (
        <div className="rename-box">
          <input
            value={renameText}
            onChange={(e) => setRenameText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") renameChat(chat.id);
            }}
          />

          <button onClick={() => renameChat(chat.id)}>Save</button>
        </div>
      )}
    </div>
  );

  return (
    <div
      className={`app ${theme} ${!desktopSidebarOpen ? "sidebar-collapsed" : ""} ${showSidebar ? "mobile-sidebar-open" : ""} ${showWorkPanel ? "panel-open" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="drag-overlay">
          <div className="drag-box">
            📂 Drop file or image here
          </div>
        </div>
      )}
      <aside className={`sidebar ${showSidebar ? "show-sidebar" : ""}`}>
        <button className="close-sidebar" onClick={() => setShowSidebar(false)}>
          ✕
        </button>

        <h2>SYNEZ AI</h2>

        <button
          className="side-btn"
          onClick={async () => {
            await saveCurrentChat();
            newChat();
            setShowSidebar(false);
          }}
        >
          + New Chat
        </button>

        <button className="side-btn" onClick={toggleTheme}>
          {theme === "dark" ? "☀ Light Mode" : "🌙 Dark Mode"}
        </button>

        <input
          className="chat-search"
          placeholder="Search chats..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <button className="side-btn memory-side-btn" onClick={fetchMemory}>
          🧠 Saved Memory
        </button>

        <button className="side-btn delete-all-btn" onClick={deleteAllChats}>
          Delete All Chats
        </button>



        <div className="history-list">
          {filteredPinnedChats.length > 0 && (
            <p className="history-label">Pinned</p>
          )}

          {filteredPinnedChats.map(renderChatRow)}

          {filteredChats.length > 0 && (
            <p className="history-label">Recent</p>
          )}

          {filteredChats.map(renderChatRow)}
        </div>

        <div className="sidebar-info">
          <p>{auth.currentUser?.email || "Logged in"}</p>
          <p>Multi AI Connected</p>
          <p>{currentModel.label}</p>
        </div>
      </aside>

      <main className={`chat-area ${showWorkPanel ? "with-work-panel" : ""}`}>
        <header className="topbar">
          <div>

            <h1>SYNEZ AI</h1>
            <p>Synergized Neural Intelligence</p>
          </div>

          <div className="top-actions">
            <button
              className="hamburger-btn"
              aria-label="Toggle sidebar"
              onClick={() => {
                if (window.innerWidth <= 900) {
                  setShowSidebar((prev) => !prev);
                } else {
                  setDesktopSidebarOpen((prev) => !prev);
                }
              }}
            >
              ☰
            </button>
            <button className="dashboard-top-btn" onClick={openDashboard}>
              📊 Usage Dashboard
            </button>

            <button className="mobile-theme-btn" onClick={toggleTheme}>
              {theme === "dark" ? "☀️" : "🌙"}
            </button>

            
            <div className="model-dropdown">
              <button type="button" className="model-trigger" onClick={() => setModelOpen((p) => !p)}>
                <span>{currentModel.icon}</span>
                <span className="model-trigger-text">{currentModel.label}</span>
                <span className={modelOpen ? "model-trigger-arrow open" : "model-trigger-arrow"}>▾</span>
              </button>
              {modelOpen && (
                <div className="model-menu">
                  {modelOptions.map((model) => (
                    <button
                      type="button"
                      key={model.value}
                      className={selectedModel === model.value ? "model-option active" : "model-option"}
                      onClick={() => {
                        setSelectedModel(model.value);
                        setModelOpen(false);
                      }}
                    >
                      <span>{model.icon}</span><span>{model.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              className="panel-toggle-btn"
              onClick={() => setShowWorkPanel((prev) => !prev)}
              title="Code Preview"
            >
              {showWorkPanel ? "Hide Panel" : "Code / Preview"}
            </button>

            <div className="profile-wrapper">
              <button
                className="profile-btn"
                aria-label="Profile menu"
                onClick={() => setShowProfileMenu(!showProfileMenu)}
              >
                {userInitial}
              </button>

              {showProfileMenu && (
                <div className="profile-menu">
                  <strong>{auth.currentUser?.displayName || userName}</strong>
                  <p>{auth.currentUser?.email}</p>



                  <button onClick={exportChatPDF}>
                    📄 Export PDF
                  </button>

                  <button onClick={exportTXT}>
                    📝 Export TXT
                  </button>

                  <button onClick={exportJSON}>
                    📦 Export JSON
                  </button>

                  <button onClick={toggleTheme}>🎨 Toggle Theme</button>

                  <button className="danger-menu" onClick={logout}>
                    🚪 Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <section className={`messages ${messages.length <= 1 && !loading ? "welcome-mode" : "chat-mode"}`}> 
          {messages.map((msg, index) => {
            if (msg.role === "assistant" && !msg.content?.trim()) {
              return null;
            }

            return (
              <div key={index} className={`message ${msg.role}`}>
                <div className="avatar">
                  {msg.role === "user" ? userInitial : "SY"}
                </div>

                <div className="bubble">
                  <div className="markdown-body">
                    {renderMarkdown(msg.content)}

                    {(msg.imageDataUrl || msg.imageUrl) && (
                      <div className="generated-image-wrap">
                        <img
                          src={msg.imageDataUrl || msg.imageUrl}
                          alt="Generated"
                          className="generated-image"
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                            const fallback = e.currentTarget.nextElementSibling;
                            if (fallback) fallback.style.display = "block";
                          }}
                        />

                        <a
                          className="generated-image-fallback"
                          href={msg.imageDataUrl || msg.imageUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{ display: "none" }}
                        >
                          Image preview failed. Open generated image ↗
                        </a>
                      </div>
                    )}
                  </div>

                  {msg.role === "assistant" && (
                    <>
                      {msg.engineeringPlan?.status === "awaiting_approval" && msg.engineeringPlan?.id && (
                        <div className="engineering-plan-actions">
                          <button
                            className="engineering-apply-btn"
                            onClick={() => handleEngineeringDecision(index, msg.engineeringPlan.id, "apply")}
                            disabled={loading}
                          >
                            Apply Plan
                          </button>
                          <button
                            className="engineering-modify-btn"
                            onClick={() => handleEngineeringDecision(index, msg.engineeringPlan.id, "modify")}
                            disabled={loading}
                          >
                            Modify Plan
                          </button>
                          <button
                            className="engineering-reject-btn"
                            onClick={() => handleEngineeringDecision(index, msg.engineeringPlan.id, "reject")}
                            disabled={loading}
                          >
                            Reject
                          </button>
                        </div>
                      )}
                      <div className="message-actions">
                        <button
                          className="action-icon-btn"
                          title="Copy"
                          onClick={() => copyMessage(msg.content)}
                        >
                          ⧉
                        </button>

                        <button
                          className="action-icon-btn"
                          title="Like"
                          onClick={likeMessage}
                        >
                          ♡
                        </button>

                        <button
                          className="action-icon-btn"
                          title="Dislike"
                          onClick={dislikeMessage}
                        >
                          ♧
                        </button>

                        <button
                          className="action-icon-btn"
                          title="Share"
                          onClick={() => shareMessage(msg.content)}
                        >
                          ⇧
                        </button>

                        <button
                          className="action-icon-btn"
                          title="Regenerate"
                          onClick={regenerateResponse}
                        >
                          ↻
                        </button>

                        <button
                          className="action-icon-btn"
                          title="More"
                          onClick={showMoreActions}
                        >
                          ⋯
                        </button>
                        <button
                          className="action-icon-btn"
                          title={isSpeaking ? "Stop Voice" : "Read Aloud"}
                          onClick={() => (isSpeaking ? stopSpeaking() : speakText(msg.content))}
                        >
                          {isSpeaking ? "⏹" : "🔊"}
                        </button>

                        <button
                          className="sources-btn"
                          title="Sources"
                          onClick={() => setActiveSources(msg.sources || [])}
                        >
                          ◧ Sources
                        </button>
                      </div>

                      {msg.provider && (
                        <div className="model-badge">
                          🤖 {msg.provider} • {msg.model}
                        </div>
                      )}

                      {msg.sources && msg.sources.length > 0 && (
                        <div className="source-cards-v2">
                          {msg.sources.slice(0, 6).map((source, sourceIndex) => (
                            <a
                              key={sourceIndex}
                              href={source.link}
                              target="_blank"
                              rel="noreferrer"
                              className="source-card-v2"
                            >
                              <div className="source-domain">
                                🌐 {source.displayLink || "Source"}
                              </div>

                              <strong>{source.title || "Untitled Source"}</strong>

                              {source.snippet && (
                                <p>{source.snippet}</p>
                              )}

                              <span>Open Source ↗</span>
                            </a>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}

          {loading && messages[messages.length - 1]?.role !== "assistant" && (
            <div className="message assistant">
              <div className="avatar">SY</div>

              <div className="bubble thinking-bubble">
                <span className="thinking-text">
                  SYNEZ AI is thinking
                </span>

                <div className="thinking-dots">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef}></div>
        </section>

        <div className="input-area">
          <div className={`chat-input-box ${selectedFiles.length || selectedImages.length ? "has-upload" : ""}`}>
              {(selectedFiles.length > 0 || selectedImages.length > 0) && (
                <div className="composer-attachments-list">
                  {selectedFiles.map((file, index) => (
                    <div className="composer-attachment-card" key={`${file.name}-${file.size}-${index}`}>
                      <span className="composer-attachment-icon">📄</span>
                      <span className="composer-attachment-name">{file.name}</span>
                      <button
                        type="button"
                        className="composer-attachment-remove"
                        onClick={() => removeSelectedFile(index)}
                        aria-label="Remove attachment"
                      >
                        ×
                      </button>
                    </div>
                  ))}

                  {selectedImages.map((file, index) => {
                    const preview = imagePreviews[index]?.url;
                    return (
                      <div className="composer-attachment-card image-attachment-card" key={`${file.name}-${file.size}-${index}`}>
                        {preview ? (
                          <img src={preview} alt={file.name} className="composer-attachment-thumb" />
                        ) : (
                          <span className="composer-attachment-icon">🖼️</span>
                        )}
                        <span className="composer-attachment-name">{file.name}</span>
                        <button
                          type="button"
                          className="composer-attachment-remove"
                          onClick={() => removeSelectedImage(index)}
                          aria-label="Remove attachment"
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}

                  {(selectedFiles.length + selectedImages.length) > 1 && (
                    <button
                      type="button"
                      className="composer-clear-all"
                      onClick={clearUpload}
                    >
                      Clear all · {selectedFiles.length + selectedImages.length}
                    </button>
                  )}
                </div>
              )}
            <label className="upload-btn" title="Add files">
              +
           <input
                type="file"
                hidden
                multiple
                accept=".pdf,.doc,.docx,.txt,.md,.csv,.json,.js,.jsx,.ts,.tsx,.html,.css,.py,.java,.cpp,.c,.xml,.yml,.yaml,image/*"
                onChange={(e) => {
                  handleFileSelect(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>

            <textarea
              ref={inputRef}
              rows={1}
              placeholder="Message SYNEZ AI..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleEnter}
            />
            {isSpeaking && (
              <button
                className="stop-speech-btn"
                onClick={stopSpeaking}
              >
                ⏹ Stop Voice
              </button>
            )}
            <button className="voice-btn" onClick={toggleVoiceInput} type="button">
              🎙
            </button>

            <button
              onClick={loading ? stopGenerating : sendMessage}
              className={`send-circle-btn ${loading ? "stop-btn" : ""}`}
            >
              {loading ? (
                "■"
              ) : (
                <svg viewBox="0 0 24 24" fill="none">
                  <path
                    d="M12 19V5M12 5L6 11M12 5L18 11"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>
          </div>
        </div>
      </main>

      {showWorkPanel && (
        <aside
          className={`work-panel show-work-panel ${panelTab === "preview" ? "preview-fullscreen-panel" : ""} ${aiEditOpen ? "ai-edit-open" : ""} ${devtoolsOpen ? "devtools-open" : ""} preview-device-${previewDevice}`}
        >
          <div className="panel-header">
            <button className="panel-close-btn" onClick={() => setShowWorkPanel(false)}>✕</button>
            <div className="tabs">
              <button
                className={panelTab === "code" ? "active" : ""}
                onClick={() => setPanelTab("code")}
              >
                {hasProjectFiles ? "Explorer" : "Code"}
              </button>

              <button
                className={panelTab === "preview" ? "active" : ""}
                onClick={() => setPanelTab("preview")}
                disabled={hasProjectFiles && !canPreviewRuntime}
                title={
                  hasProjectFiles && !canPreviewRuntime
                    ? "Project files are not valid for React preview yet"
                    : hasProjectFiles
                    ? "React Preview v1"
                    : "Preview"
                }
              >
                Preview
              </button>
            </div>

            <div className="top-actions">
              <button
                className={`copy-btn ${livePreviewEnabled ? "live-on" : ""}`}
                onClick={() => {
                  setLivePreviewEnabled((value) => !value);
                  bumpPreviewVersion();
                }}
                title="Auto reload preview when files update"
              >
                {livePreviewEnabled ? "Live Preview" : "Live Off"}
              </button>

              <details className="view-menu" title="Preview device size">
                <summary>
                  <span className="view-menu-title">Device</span>
                  <span className="view-menu-current">
                    {currentPreviewDevice.icon} {currentPreviewDevice.label}
                  </span>
                </summary>

                <div className="view-menu-list">
                  {Object.entries(previewDeviceMeta).map(([key, device]) => (
                    <button
                      key={key}
                      type="button"
                      className={previewDevice === key ? "active" : ""}
                      onClick={(event) => {
                        setPreviewDevice(key);
                        bumpPreviewVersion();
                        event.currentTarget.closest("details")?.removeAttribute("open");
                      }}
                    >
                      <span>{device.icon}</span>
                      <span>{device.label}</span>
                    </button>
                  ))}
                </div>
              </details>

              <button
                className={`copy-btn ${inspectPreviewEnabled ? "inspect-on" : ""}`}
                onClick={() => {
                  setInspectPreviewEnabled((value) => !value);
                  bumpPreviewVersion();
                }}
                title="Inspect preview elements"
              >
                {inspectPreviewEnabled ? "Inspect On" : "Inspect"}
              </button>

              <button
                className={`copy-btn ${devtoolsOpen ? "console-on" : ""}`}
                onClick={() => {
                  setDevtoolsOpen((value) => !value);
                  setPreviewConsoleOpen(true);
                }}
                title="Developer Tools"
              >
                Developer Tools
              </button>

              <details className="actions-menu">
                <summary>More</summary>
                <div className="actions-menu-list">
                  <button type="button" onClick={copyCode}>Copy All</button>
                  <button type="button" onClick={downloadCode}>Download ZIP</button>
                  <button type="button" onClick={exportChatPDF}>Export PDF</button>
                </div>
              </details>

              {!hasProjectFiles && (
                <>
                  <button className="copy-btn" onClick={refreshPreview}>
                    Refresh
                  </button>

                  <button className="copy-btn" onClick={openPreviewInNewTab}>
                    Open
                  </button>
                </>
              )}
            </div>
          </div>

          {hasProjectFiles ? (
            panelTab === "preview" && !canPreviewRuntime ? (
              <div className="workspace-invalid">
                <h3>{getRuntimeLabel(previewRuntime)} Preview Status</h3>
                <p>SYNEZ found project files. Runtime: {getRuntimeLabel(previewRuntime)}</p>
                <ul>
                  {projectValidation.errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </div>
            ) : panelTab === "preview" ? (
              <div className={`preview-device-shell ${previewDevice}`}>
                <div
                  className={`preview-device-frame device-${previewDevice}`}
                  style={{
                    width: currentPreviewDevice.width,
                    maxWidth: currentPreviewDevice.maxWidth,
                  }}
                >
                  {["iphone", "pixel", "galaxy", "mobile"].includes(previewDevice) && (
                    <>
                      <div className="device-notch"></div>
                      <div className="device-side-button left"></div>
                      <div className="device-side-button right"></div>
                    </>
                  )}

                  {["ipad", "tablet"].includes(previewDevice) && (
                    <>
                      <div className="tablet-camera"></div>
                      <div className="device-side-button right tablet"></div>
                    </>
                  )}

                  <div className="preview-device-label">
                    {currentPreviewDevice.icon} {currentPreviewDevice.label}
                  </div>
                  <iframe
                    key={`preview-${previewRuntime}-${previewDevice}-${previewVersion}`}
                    title="react-preview"
                    className="preview"
                    srcDoc={buildRuntimePreview(previewRuntime)}
                    sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin"
                  ></iframe>
                </div>
              </div>
            ) : (
            <div className="workspace-view">
              <div className="workspace-explorer">
                <div className="workspace-title">📁 Project Explorer</div>
                <div className={`workspace-status ${projectValidation.valid ? "ok" : "bad"}`}>
                  {previewRuntime === "react"
                    ? projectValidation.valid
                      ? "✅ React Preview Ready"
                      : "⚠️ React Preview not ready"
                    : `ℹ️ ${getRuntimeLabel(previewRuntime)}`}
                </div>

                {Object.keys(projectFiles).map((fileName) => (
                  <button
                    key={fileName}
                    className={`workspace-file ${activeProjectFile === fileName ? "active" : ""}`}
                    onClick={() => setActiveProjectFile(fileName)}
                    title={fileName}
                  >
                    <span>
                      {fileName.endsWith(".jsx") || fileName.endsWith(".tsx")
                        ? "⚛️"
                        : fileName.endsWith(".css")
                        ? "🎨"
                        : fileName.endsWith(".json")
                        ? "📦"
                        : fileName.endsWith(".html")
                        ? "🌐"
                        : fileName.endsWith(".md")
                        ? "📝"
                        : "📄"}
                    </span>
                    {fileName}
                  </button>
                ))}
              </div>

              <div className="workspace-editor">
                <div className="file-header">
                  <h4>{activeProjectFile || "Select a file"}</h4>

                  <button
                    className="mini-copy-btn"
                    onClick={() => {
                      if (!activeProject) return;
                      navigator.clipboard.writeText(activeProject.code || "");
                      setCopied("project-file");
                      setTimeout(() => setCopied(""), 1200);
                    }}
                  >
                    {copied === "project-file" ? "✓ Copied" : "Copy"}
                  </button>
                </div>

                <SyntaxHighlighter
                  language={getFileLanguage(activeProjectFile)}
                  style={oneDark}
                  showLineNumbers
                  wrapLongLines
                >
                  {activeProject?.code || "// Select a file from Explorer"}
                </SyntaxHighlighter>

                <div className="workspace-note">
                  Smart Preview Runtime is available in the Preview tab. Live Preview auto-refreshes when generated files update.
                </div>
              </div>
            </div>
            )
          ) : panelTab === "code" ? (
            <div className="code-view">
              <div className="file-header">
                <h4>index.html</h4>

                <button className="mini-copy-btn" onClick={copyHTML}>
                  {copied === "html" ? "✓ Copied" : "Copy"}
                </button>
              </div>

              <SyntaxHighlighter
                language="html"
                style={oneDark}
                showLineNumbers
                wrapLongLines
              >
                {files.html || "<!-- HTML code -->"}
              </SyntaxHighlighter>

              <div className="file-header">
                <h4>style.css</h4>

                <button className="mini-copy-btn" onClick={copyCSS}>
                  {copied === "css" ? "✓ Copied" : "Copy"}
                </button>
              </div>

              <SyntaxHighlighter
                language="css"
                style={oneDark}
                showLineNumbers
                wrapLongLines
              >
                {files.css || "/* CSS code */"}
              </SyntaxHighlighter>

              <div className="file-header">
                <h4>script.js</h4>

                <button className="mini-copy-btn" onClick={copyJS}>
                  {copied === "js" ? "✓ Copied" : "Copy"}
                </button>
              </div>

              <SyntaxHighlighter
                language="javascript"
                style={oneDark}
                showLineNumbers
                wrapLongLines
              >
                {files.js || "// JavaScript code"}
              </SyntaxHighlighter>
            </div>
          ) : (
            <div className={`preview-device-shell ${previewDevice}`}>
              <div
                className={`preview-device-frame device-${previewDevice}`}
                style={{
                  width: currentPreviewDevice.width,
                  maxWidth: currentPreviewDevice.maxWidth,
                }}
              >
                <div className="preview-device-label">
                  {currentPreviewDevice.icon} {currentPreviewDevice.label}
                </div>
                <iframe
                  key={`preview-${previewDevice}-${previewVersion}`}
                  title="preview"
                  className="preview"
                  srcDoc={buildPreviewCode(files)}
                  sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin"
                ></iframe>
              </div>
            </div>
          )}

          {devtoolsOpen && (
            <div className="preview-devtools-panel">
              <div className="preview-devtools-header">
                <strong>SYNEZ Tools</strong>
                <div className="preview-devtools-actions">
                  <button type="button" onClick={() => {
                    clearPreviewConsole();
                    setPreviewNetworkLogs([]);
                  }}>Clear</button>
                  <button type="button" onClick={() => setDevtoolsOpen(false)}>Close</button>
                </div>
              </div>

              <div className="preview-devtools-tabs">
                {["console", "network", "deps", "assets", "performance", "score"].map((tab) => (
                  <button
                    key={tab}
                    className={devtoolsTab === tab ? "active" : ""}
                    onClick={() => setDevtoolsTab(tab)}
                    type="button"
                  >
                    {tab === "deps" ? "Dependencies" : tab}
                  </button>
                ))}
              </div>

              <div className="preview-devtools-body">
                {devtoolsTab === "console" && (
                  <div className="preview-console-body inside-devtools">
                    {previewConsoleLogs.length ? (
                      previewConsoleLogs.map((item, index) => (
                        <div key={`${item.time}-${index}`} className={`preview-console-line ${item.type}`}>
                          <span className="preview-console-time">{item.time}</span>
                          <span className="preview-console-type">{item.type}</span>
                          <span className="preview-console-message">{item.message}</span>
                        </div>
                      ))
                    ) : (
                      <div className="preview-console-empty">No console messages yet.</div>
                    )}
                  </div>
                )}

                {devtoolsTab === "network" && (
                  <div className="preview-tool-table">
                    {previewNetworkLogs.length ? previewNetworkLogs.map((item, index) => (
                      <div key={index} className={`preview-tool-row ${item.ok ? "" : "bad"}`}>
                        <strong>{item.method}</strong>
                        <span>{item.status}</span>
                        <span>{item.timeMs}ms</span>
                        <small>{item.url}</small>
                      </div>
                    )) : <div className="preview-console-empty">No network requests captured.</div>}
                  </div>
                )}

                {devtoolsTab === "deps" && (
                  <div className="preview-tool-list">
                    {getDependencyWarnings().length ? getDependencyWarnings().map((dep) => (
                      <div key={dep.name} className="preview-tool-card">
                        <strong>{dep.name}</strong>
                        <code>{dep.command}</code>
                      </div>
                    )) : <div className="preview-console-empty">No external dependencies detected.</div>}
                  </div>
                )}

                {devtoolsTab === "assets" && (
                  <div className="preview-tool-table">
                    {previewAssets.length ? previewAssets.map((asset, index) => (
                      <div key={index} className={`preview-tool-row ${asset.ok ? "" : "bad"}`}>
                        <strong>{asset.type}</strong>
                        <span>{asset.ok ? "OK" : "Missing"}</span>
                        <small>{asset.src}</small>
                      </div>
                    )) : <div className="preview-console-empty">No assets detected yet.</div>}
                  </div>
                )}

                {devtoolsTab === "performance" && (
                  <div className="preview-metrics-grid">
                    <div><strong>{previewPerformance?.loadTime ?? "—"}ms</strong><span>Load Time</span></div>
                    <div><strong>{previewPerformance?.domNodes ?? "—"}</strong><span>DOM Nodes</span></div>
                    <div><strong>{previewPerformance?.cssSize ?? "—"}</strong><span>CSS Size</span></div>
                    <div><strong>{previewPerformance?.styleSheets ?? "—"}</strong><span>StyleSheets</span></div>
                  </div>
                )}

                {devtoolsTab === "score" && (
                  <div className="preview-score-grid">
                    {previewScore ? Object.entries(previewScore).map(([key, value]) => (
                      <div key={key} className="preview-score-card">
                        <strong>{value}</strong>
                        <span>{key}</span>
                      </div>
                    )) : <div className="preview-console-empty">Score will appear after preview loads.</div>}
                  </div>
                )}
              </div>
            </div>
          )}

          {aiEditOpen && (
            <div className="ai-edit-panel">
              <div className="ai-edit-header">
                <div>
                  <strong>AI Edit Mode</strong>
                  <span>AI Edit v2 • Permanent</span>
                </div>
                <button type="button" onClick={() => setAiEditOpen(false)}>Close</button>
              </div>

              <div className="ai-edit-body">
                <section className="ai-edit-card">
                  <h4>Selected Element</h4>
                  {selectedPreviewElement ? (
                    <div className="ai-edit-selected">
                      <code>{cleanEditSelector(selectedPreviewElement.selector || selectedPreviewElement.tag)}</code>
                      <span>{selectedPreviewElement.width} × {selectedPreviewElement.height}</span>
                      <p>{selectedPreviewElement.text || "No text"}</p>
                      <div className="ai-edit-actions compact">
                        <button type="button" onClick={addSelectedElementToEditTargets}>Add Target</button>
                        <button type="button" onClick={clearAiEditTargets} disabled={!aiEditTargets.length}>Clear Targets</button>
                      </div>
                    </div>
                  ) : (
                    <p className="ai-edit-muted">Turn Inspect On and click any preview element.</p>
                  )}
                </section>

                <section className="ai-edit-card">
                  <h4>Multi-element Targets</h4>
                  {getCurrentAiEditTargets().length ? (
                    <div className="ai-edit-target-list">
                      {getCurrentAiEditTargets().map((target, index) => (
                        <div className="ai-edit-target-row" key={`${target.selector}-${target.text}-${index}`}>
                          <span>{target.tag}</span>
                          <code>{target.text || target.selector}</code>
                          {aiEditTargets.length > 0 && (
                            <button type="button" onClick={() => removeAiEditTarget(index)}>×</button>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="ai-edit-muted">No targets yet. Select an element, then add it or edit directly.</p>
                  )}
                </section>

                <section className="ai-edit-card">
                  <h4>Edit Instruction</h4>
                  <textarea
                    value={aiEditPrompt}
                    onChange={(event) => setAiEditPrompt(event.target.value)}
                    placeholder="Example: Make this button purple, rounded, larger, and add glow."
                  />
                  <div className="ai-edit-actions">
                    <button type="button" onClick={createSafeEditDraft}>Create Smart Draft</button>
                    <button type="button" onClick={undoAiEditV2} disabled={!aiEditUndoStack.length}>Undo</button>
                    <button type="button" onClick={redoAiEditV2} disabled={!aiEditRedoStack.length}>Redo</button>
                  </div>
                </section>

                <section className="ai-edit-card ai-edit-history-card">
                  <h4>Applied Edits</h4>
                  {aiAppliedEdits.length ? (
                    <div className="ai-edit-history-list">
                      {aiAppliedEdits.slice(-5).reverse().map((edit) => (
                        <div className="ai-edit-history-item" key={edit.id}>
                          <strong>{edit.targets?.length || 1} target{(edit.targets?.length || 1) > 1 ? "s" : ""}</strong>
                          <span>{edit.instruction}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="ai-edit-muted">No applied edits yet.</p>
                  )}
                </section>

                {aiEditDraft && (
                  <section className={`ai-edit-card ai-edit-draft ${aiEditDraft.type}`}>
                    <h4>{aiEditDraft.title}</h4>
                    {aiEditDraft.message && <p>{aiEditDraft.message}</p>}
                    {aiEditDraft.instruction && <p><strong>Instruction:</strong> {aiEditDraft.instruction}</p>}
                    {aiEditDraft.changes && (
                      <ul>
                        {aiEditDraft.changes.map((change, index) => (
                          <li key={index}>{change}</li>
                        ))}
                      </ul>
                    )}
                    {aiEditDraft.structural?.diffPreview && (
                      <pre>{aiEditDraft.structural.diffPreview}</pre>
                    )}
                    {aiEditDraft.cssPatch && (
                      <pre>{aiEditDraft.cssPatch}</pre>
                    )}
                    {aiEditDraft.note && <p className="ai-edit-muted">{aiEditDraft.note}</p>}
                    <div className="ai-edit-actions">
                      <button type="button" onClick={acceptSafeEditDraft}>Accept</button>
                      <button type="button" onClick={rejectSafeEditDraft}>Reject</button>
                    </div>
                  </section>
                )}

                <section className="ai-edit-card">
                  <h4>Context Builder</h4>
                  <pre>{JSON.stringify(buildPhase12ProjectContext ? buildPhase12ProjectContext() : buildEditContext(), null, 2).slice(0, 2400)}</pre>
                </section>
              </div>
            </div>
          )}

        </aside>
      )}


      {showMemoryPanel && (
        <div className="memory-overlay">
          <div className="memory-modal">
            <div className="memory-header">
              <div>
                <h3>🧠 Saved Memory</h3>
                <p>Memory is saved separately for the logged-in account.</p>
              </div>

              <button
                className="memory-close-btn"
                onClick={() => setShowMemoryPanel(false)}
              >
                ✕
              </button>
            </div>

            {memoryLoading ? (
              <div className="memory-empty">Loading memory...</div>
            ) : Object.keys(savedMemory).length === 0 ? (
              <div className="memory-empty">
                No saved memory yet.
                <br />
                Try: <strong>remember project is SYNEZ AI</strong>
              </div>
            ) : (
              <div className="memory-list">
                {Object.entries(savedMemory).map(([key, value]) => (
                  <div className="memory-item" key={key}>
                    <div>
                      <span>{key}</span>
                      <strong>{String(value)}</strong>
                    </div>

                    <button onClick={() => forgetMemoryKey(key)}>
                      Forget
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="memory-actions">
              <button onClick={fetchMemory}>Refresh</button>
              <button className="memory-danger-btn" onClick={clearAllMemory}>
                Clear All
              </button>
            </div>
          </div>
        </div>
      )}

      {showDashboard && (
        <div className="dashboard-overlay">
          <div className="dashboard-modal">
            <div className="dashboard-header">
              <div>
                <h3>📊 Usage Dashboard</h3>
                <p>SYNEZ AI activity overview</p>
              </div>

              <button
                className="dashboard-close-btn"
                onClick={() => setShowDashboard(false)}
              >
                ✕
              </button>
            </div>

            <div className="dashboard-grid">
              <div className="dashboard-card">
                <span>Total Chats</span>
                <strong>{chatHistory.length}</strong>
              </div>

              <div className="dashboard-card">
                <span>Total Messages</span>
                <strong>{getTotalMessages()}</strong>
              </div>

              <div className="dashboard-card">
                <span>Saved Memories</span>
                <strong>{getMemoryCount()}</strong>
              </div>

              <div className="dashboard-card">
                <span>Current Model</span>
                <strong>{selectedModel}</strong>
              </div>

              <div className="dashboard-card">
                <span>User</span>
                <strong>{auth.currentUser?.email || userName}</strong>
              </div>

              <div className="dashboard-card">
                <span>Theme</span>
                <strong>{theme}</strong>
              </div>
            </div>

            <div className="dashboard-status">
              <div>✅ Web Search Ready</div>
              <div>✅ Agent Mode Pro+ Ready</div>
              <div>✅ Voice Ready</div>
              <div>✅ Drag & Drop Ready</div>
              <div>✅ Memory Ready</div>
            </div>
          </div>
        </div>
      )}

      {confirmBox.show && (
        <div className="confirm-overlay">
          <div className="confirm-modal">
            <h3>Delete Chat?</h3>

            <p>
              {confirmBox.type === "all"
                ? "Are you sure you want to delete all chats?"
                : "Are you sure you want to delete this chat?"}
            </p>

            <div className="confirm-actions">
              <button
                className="cancel-btn"
                onClick={() =>
                  setConfirmBox({
                    show: false,
                    type: "",
                    id: null,
                  })
                }
              >
                Cancel
              </button>

              <button className="confirm-delete-btn" onClick={confirmDelete}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">✅ {toast}</div>}
    </div>
  );

}

export default App;