
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { 
  Mic, MicOff, Shield, ShieldOff, FileText, Send, Ghost, Lock, 
  History, Activity, Copy, Check, Minimize2, Maximize2, Loader2, MessageSquare,
  Eye, EyeOff, Wind, Radio, AlertTriangle
} from 'lucide-react';
import { Suggestion, ConnectionStatus } from './types';
import { createPcmBlob, encode } from './services/audioUtils';

const MODEL_NAME = 'gemini-2.5-flash-native-audio-preview-12-2025';

const App: React.FC = () => {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isMiniMode, setIsMiniMode] = useState(false);
  const [isShieldActive, setIsShieldActive] = useState(false);
  const [isGlassMode, setIsGlassMode] = useState(false);
  const [isAutoStealth, setIsAutoStealth] = useState(true);
  const [isWindowBlurred, setIsWindowBlurred] = useState(false);
  const [liveStreamText, setLiveStreamText] = useState("");
  const [detectedCategory, setDetectedCategory] = useState<string>("SYNCING...");
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [resumeText, setResumeText] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [isParsing, setIsParsing] = useState(false);
  const [inputText, setInputText] = useState("");
  
  const audioContextInRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const currentOutputRef = useRef('');

  useEffect(() => {
    const handleBlur = () => setIsWindowBlurred(true);
    const handleFocus = () => setIsWindowBlurred(false);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  const effectiveShield = isShieldActive || (isAutoStealth && isWindowBlurred);

  const latestStateRef = useRef({ liveStreamText, detectedCategory });
  useEffect(() => {
    latestStateRef.current = { liveStreamText, detectedCategory };
  }, [liveStreamText, detectedCategory]);

  const processStream = useCallback((text: string) => {
    currentOutputRef.current += text;
    if (currentOutputRef.current.includes("ANSWER:")) {
      const parts = currentOutputRef.current.split("ANSWER:");
      const categoryPart = parts[0].replace("CATEGORY:", "").trim();
      const answer = parts[1]?.trim();
      
      if (categoryPart && categoryPart !== latestStateRef.current.detectedCategory) {
        setDetectedCategory(categoryPart.toUpperCase());
      }
      if (answer) {
        // Remove any unintentional "Candidate:" or "The user" prefixes if they leak through
        const cleanedAnswer = answer.replace(/^(Candidate|The user|The applicant|He|She|Based on his resume|Swapnil):\s*/i, '');
        setLiveStreamText(cleanedAnswer);
      }
    }
  }, []);

  const processStreamRef = useRef(processStream);
  useEffect(() => {
    processStreamRef.current = processStream;
  }, [processStream]);

  const stopSession = useCallback(() => {
    if (sessionPromiseRef.current) {
      sessionPromiseRef.current.then(session => { 
        try { session.close(); } catch (e) { console.debug("Session cleanup:", e); } 
      });
    }
    if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
    if (audioContextInRef.current) audioContextInRef.current.close();
    
    setStatus('disconnected');
    sessionPromiseRef.current = null;
    streamRef.current = null;
    audioContextInRef.current = null;
  }, []);

  const startSession = useCallback(async () => {
    if (!resumeText) return;
    try {
      setStatus('connecting');
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const audioIn = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      audioContextInRef.current = audioIn;

      // REFINED SYSTEM INSTRUCTION: Strict Professional First-Person Perspective
      const systemInstruction = `Role: You are an expert invisible interview assistant. 
      You are speaking AS the candidate. You are providing direct answers to be read aloud.

      STRICT RULES:
      1. DO NOT ever use names (e.g., 'Swapnil').
      2. DO NOT refer to 'the candidate' or 'this resume'.
      3. ALWAYS use the FIRST PERSON ('I', 'My', 'We'). 
      4. Example: Instead of 'Swapnil has 5 years experience', say 'I have 5 years of experience'.
      5. Provide clear, concise, technically deep answers.
      6. OUTPUT FORMAT: CATEGORY: {Type} | ANSWER: {Text}.
      7. No conversational filler. No 'Sure, I can help with that'. Just the category and the answer.

      Context (Candidate Background):
      ${resumeText.substring(0, 6000)}`;

      const sessionPromise = ai.live.connect({
        model: MODEL_NAME,
        config: {
          systemInstruction,
          responseModalities: [Modality.AUDIO],
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            setStatus('connected');
            const source = audioIn.createMediaStreamSource(stream);
            const scriptProcessor = audioIn.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              sessionPromise.then(session => {
                if (streamRef.current?.active) {
                  session.sendRealtimeInput({ media: createPcmBlob(inputData) });
                }
              }).catch(() => {
                scriptProcessor.disconnect();
                source.disconnect();
              });
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(audioIn.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.outputTranscription) {
              processStreamRef.current(message.serverContent.outputTranscription.text);
            }
            if (message.serverContent?.turnComplete) {
              const { liveStreamText: currentAnswer, detectedCategory: currentCat } = latestStateRef.current;
              if (currentAnswer) {
                setSuggestions(prev => [{ 
                  id: Math.random().toString(), 
                  title: currentCat, 
                  content: currentAnswer, 
                  type: 'answer' 
                }, ...prev].slice(0, 20));
              }
              currentOutputRef.current = '';
            }
          },
          onerror: (err) => { 
            console.error("Live API Error:", err);
            // Handle Network Errors gracefully - often a transient WebSocket drop
            if (err.toString().includes("Network error") || err.toString().includes("404")) {
               setStatus('error');
               // Optional: Trigger a silent retry logic here if needed
            }
          },
          onclose: (e) => {
            console.debug("Connection closed:", e.reason);
            if (status !== 'disconnected') {
              setStatus('disconnected');
              stopSession();
            }
          }
        }
      });
      sessionPromiseRef.current = sessionPromise;
    } catch (err) { 
      console.error("Initialization Failed:", err);
      setStatus('error'); 
      stopSession(); 
    }
  }, [resumeText, stopSession, status]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setIsParsing(true);
    try {
      if (file.type === 'application/pdf') {
        const arrayBuffer = await file.arrayBuffer();
        // @ts-ignore
        const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let fullText = "";
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          fullText += textContent.items.map((item: any) => item.str).join(" ") + "\n";
        }
        setResumeText(fullText);
      } else {
        const reader = new FileReader();
        reader.onload = (event) => setResumeText(event.target?.result as string);
        reader.readAsText(file);
      }
    } catch (err) { alert("Error reading file."); } finally { setIsParsing(false); }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopyFeedback(id);
    setTimeout(() => setCopyFeedback(null), 2000);
  };

  const glassOpacity = isGlassMode ? 'bg-opacity-10 backdrop-blur-[2px]' : 'bg-opacity-100';
  const glassHeaderOpacity = isGlassMode ? 'bg-opacity-40' : 'bg-opacity-90';
  
  const appBg = effectiveShield ? 'bg-[#000000]' : (isGlassMode ? 'bg-[#000000]' : 'bg-[#050505]');
  const cardBg = effectiveShield ? 'bg-[#000000]' : (isGlassMode ? 'bg-black/20' : 'bg-[#0a0a0c]');
  
  const textShadow = isGlassMode ? 'shadow-sm drop-shadow-[0_1px_1px_rgba(0,0,0,1)]' : '';
  const textColor = effectiveShield ? 'text-[#0a0a0a]' : (isGlassMode ? 'text-white' : 'text-slate-100');
  const subTextColor = effectiveShield ? 'text-[#060606]' : 'text-slate-500';
  const accentColor = effectiveShield ? 'text-[#080808]' : 'text-indigo-500';
  const borderColor = effectiveShield ? 'border-transparent' : (isGlassMode ? 'border-white/5' : 'border-white/5');

  if (isMiniMode) {
    return (
      <div className={`w-full h-screen flex flex-col border-2 ${effectiveShield ? 'border-transparent' : 'border-indigo-600/50'} rounded-lg shadow-2xl ${appBg} ${glassOpacity} overflow-hidden relative`}>
        <div className={`flex items-center justify-between p-2 border-b ${borderColor} bg-white/5`}>
          <div className="flex items-center space-x-2">
            <div className={`w-1.5 h-1.5 rounded-full ${status === 'connected' ? 'bg-emerald-500' : 'bg-slate-700'}`}></div>
            <span className={`text-[8px] font-black uppercase ${subTextColor}`}>{detectedCategory}</span>
          </div>
          <button onClick={() => setIsMiniMode(false)} className="text-slate-500 hover:text-white"><Maximize2 className="w-3.5 h-3.5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto no-scrollbar p-3">
          <div className={`text-base font-medium leading-relaxed teleprompter-font whitespace-pre-wrap ${textColor} ${textShadow}`}>
            {liveStreamText || "Awaiting frequency..."}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen flex flex-col ${appBg} ${isGlassMode ? 'bg-opacity-20' : 'bg-opacity-100'} transition-all duration-300`}>
      <header className={`h-14 border-b ${borderColor} bg-black ${glassHeaderOpacity} flex items-center justify-between px-6 z-[100]`}>
        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-3">
            <Ghost className={`${accentColor} w-5 h-5`} />
            <h1 className={`text-[10px] font-black tracking-[0.3em] uppercase ${effectiveShield ? 'text-[#0a0a0a]' : 'text-white'}`}>
              STEALTH <span className={effectiveShield ? 'text-[#060606]' : 'text-indigo-500'}>COPILOT</span>
            </h1>
          </div>
          
          <div className="flex items-center space-x-2">
            <button 
              onClick={() => setIsShieldActive(!isShieldActive)} 
              className={`flex items-center space-x-2 px-4 py-2 rounded-full border text-[9px] font-black uppercase tracking-[0.2em] transition-all ${effectiveShield ? 'bg-indigo-600 text-white border-indigo-500 shadow-lg' : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'}`}
            >
              {effectiveShield ? <Shield className="w-4 h-4" /> : <ShieldOff className="w-4 h-4" />}
              <span>{effectiveShield ? (isShieldActive ? 'MASK: PINNED' : 'AUTO-MASK: TRIGGERED') : 'MASK: OFF'}</span>
            </button>

            <button 
              onClick={() => setIsAutoStealth(!isAutoStealth)} 
              className={`flex items-center space-x-2 px-4 py-2 rounded-full border text-[9px] font-black uppercase tracking-[0.2em] transition-all ${isAutoStealth ? 'bg-rose-500/10 text-rose-400 border-rose-500/30' : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'}`}
            >
              {isAutoStealth ? <Radio className={`w-4 h-4 ${isAutoStealth && !effectiveShield ? 'animate-pulse' : ''}`} /> : <Radio className="w-4 h-4 opacity-40" />}
              <span>{isAutoStealth ? 'SENTINEL ACTIVE' : 'SENTINEL OFF'}</span>
            </button>

            <button 
              onClick={() => setIsGlassMode(!isGlassMode)} 
              className={`flex items-center space-x-2 px-4 py-2 rounded-full border text-[9px] font-black uppercase tracking-[0.2em] transition-all ${isGlassMode ? 'bg-emerald-600 text-white border-emerald-500 shadow-lg' : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'}`}
            >
              {isGlassMode ? <Wind className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              <span>GLASS: {isGlassMode ? 'ON' : 'OFF'}</span>
            </button>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          <label className={`cursor-pointer flex items-center space-x-2 border px-4 py-2 rounded-xl transition-all text-[9px] font-black uppercase tracking-widest ${resumeText ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-white/5 border-white/10 text-slate-500'}`}>
            <FileText className="w-4 h-4" />
            <span className="max-w-[140px] truncate">{fileName || 'Upload Resume'}</span>
            <input type="file" className="hidden" accept=".txt,.pdf" onChange={handleFileUpload} />
          </label>
          <button onClick={() => setIsMiniMode(true)} className="p-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white transition-colors">
            <Minimize2 className="w-4.5 h-4.5" />
          </button>
          <button 
            onClick={() => (status === 'connected' ? stopSession() : startSession())} 
            disabled={!resumeText || isParsing}
            className={`px-8 py-2 rounded-xl font-black uppercase text-[10px] tracking-[0.2em] transition-all shadow-xl ${status === 'connected' ? 'bg-rose-600 text-white shadow-rose-900/40 hover:bg-rose-700' : (status === 'error' ? 'bg-amber-600 text-white' : 'bg-indigo-600 text-white shadow-indigo-900/40 hover:bg-indigo-700')}`}
          >
            {status === 'connected' ? 'ONLINE' : (status === 'connecting' ? 'CONNECTING...' : (status === 'error' ? 'RETRY' : 'OFFLINE'))}
          </button>
        </div>
      </header>

      {isAutoStealth && isWindowBlurred && (
        <div className="bg-rose-600 text-white text-[8px] font-black uppercase tracking-widest py-1 text-center animate-pulse">
          SENTINEL TRIGGERED: SCREEN MASK ACTIVE
        </div>
      )}

      {status === 'error' && (
        <div className="bg-amber-600 text-white text-[8px] font-black uppercase tracking-widest py-1 text-center flex items-center justify-center space-x-2">
          <AlertTriangle className="w-3 h-3" />
          <span>NETWORK INTERRUPTED. CHECK INTERNET OR API KEY STATUS AND CLICK RETRY.</span>
        </div>
      )}

      <main className="flex-1 flex overflow-hidden p-6 gap-6 h-[calc(100vh-56px)]">
        {!resumeText && (
          <div className="absolute inset-0 z-[200] bg-black/95 flex flex-col items-center justify-center p-8 text-center backdrop-blur-sm">
            <Lock className="w-12 h-12 text-indigo-500 mb-8 animate-pulse" />
            <h2 className="text-2xl font-black text-white mb-3 uppercase tracking-[0.3em]">Initialize Bio-Sync</h2>
            <p className="text-slate-500 text-sm max-w-sm mb-10 leading-relaxed">Upload your resume to activate the low-latency assistance engine.</p>
            <label className="cursor-pointer bg-indigo-600 hover:bg-indigo-700 text-white px-12 py-5 rounded-2xl font-black uppercase tracking-[0.2em] text-[12px] shadow-2xl transition-all hover:scale-[1.05] active:scale-95">
              Select File (PDF/TXT)
              <input type="file" className="hidden" accept=".txt,.pdf" onChange={handleFileUpload} />
            </label>
          </div>
        )}

        <div className="flex-1 flex flex-col gap-6 overflow-hidden">
          <section className={`flex-1 border rounded-[2.5rem] overflow-hidden flex flex-col shadow-2xl transition-all duration-300 ${cardBg} ${borderColor} ${isGlassMode ? 'backdrop-blur-[2px]' : ''}`}>
            <div className="flex-1 p-10 overflow-y-auto no-scrollbar scroll-smooth">
              <div className="w-full max-w-4xl mx-auto space-y-8">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3 flex-1">
                    <span className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-[0.3em] border ${effectiveShield ? 'bg-black border-[#060606] text-[#080808]' : 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400'}`}>
                      {detectedCategory}
                    </span>
                    <div className={`h-px flex-1 ${effectiveShield ? 'bg-[#040404]' : 'bg-white/5'}`}></div>
                  </div>
                </div>
                
                <div className={`text-lg sm:text-2xl font-medium leading-relaxed teleprompter-font whitespace-pre-wrap transition-colors duration-500 ${textColor} ${textShadow}`}>
                  {liveStreamText || (status === 'connected' ? "Listening for interviewer questions..." : "Standing by for activation...")}
                </div>
                
                {liveStreamText && (
                  <div className={`pt-10 flex items-center space-x-6 transition-opacity ${isGlassMode ? 'opacity-40 hover:opacity-100' : 'opacity-100'}`}>
                    <button 
                      onClick={() => handleCopy(liveStreamText, 'main')} 
                      className={`flex items-center space-x-3 px-8 py-3.5 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] border transition-all ${effectiveShield ? 'bg-black border-[#060606] text-[#080808]' : 'bg-white/10 border-white/5 text-slate-300 hover:text-white hover:bg-white/20'}`}
                    >
                      {copyFeedback === 'main' ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                      <span>{copyFeedback === 'main' ? 'CACHED' : 'COPY RESPONSE'}</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className={`p-6 border-t ${effectiveShield ? 'bg-black border-transparent' : (isGlassMode ? 'bg-black/10 border-white/5' : 'bg-black/40 border-white/5')} transition-all`}>
              <div className="max-w-4xl mx-auto flex items-center space-x-4">
                <input 
                  type="text" 
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && inputText.trim() && status === 'connected') {
                      sessionPromiseRef.current?.then(s => {
                        s.sendRealtimeInput({ media: { data: encode(new TextEncoder().encode(inputText)), mimeType: 'text/plain' } });
                        setInputText("");
                      });
                    }
                  }}
                  placeholder="Ask a direct technical question..."
                  className={`flex-1 border rounded-2xl px-6 py-4 text-sm focus:outline-none transition-all ${effectiveShield ? 'bg-black border-[#060606] text-[#080808] placeholder-[#040404]' : (isGlassMode ? 'bg-white/5 border-white/10 text-white placeholder-slate-500' : 'bg-white/5 border-white/10 text-slate-300')}`}
                />
                <button 
                  onClick={() => {
                    if (inputText.trim() && status === 'connected') {
                      sessionPromiseRef.current?.then(s => {
                        s.sendRealtimeInput({ media: { data: encode(new TextEncoder().encode(inputText)), mimeType: 'text/plain' } });
                        setInputText("");
                      });
                    }
                  }}
                  className={`p-4 rounded-2xl transition-all hover:scale-105 active:scale-95 ${effectiveShield ? 'bg-black text-[#080808]' : 'bg-indigo-600 text-white shadow-lg'}`}
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
            </div>
          </section>
        </div>

        {!isGlassMode && (
          <aside className="hidden xl:flex w-80 flex-col gap-6 overflow-hidden animate-in slide-in-from-right-10 duration-500">
            <div className={`flex-1 border rounded-[2.5rem] p-8 flex flex-col overflow-hidden ${cardBg} ${borderColor}`}>
              <h2 className={`font-black text-[10px] uppercase tracking-[0.4em] flex items-center space-x-3 mb-8 ${subTextColor}`}>
                <History className="w-4 h-4" />
                <span>ARCHIVE</span>
              </h2>
              
              <div className="flex-1 overflow-y-auto space-y-5 pr-2 custom-scroll no-scrollbar">
                {suggestions.map((s) => (
                  <div key={s.id} onClick={() => handleCopy(s.content, s.id)} className={`border p-6 rounded-[2rem] group transition-all cursor-pointer ${effectiveShield ? 'bg-black border-[#040404]' : 'bg-white/5 border-white/5 hover:border-indigo-500/30 hover:bg-white/[0.02]'}`}>
                    <span className={`text-[8px] font-black uppercase tracking-widest px-3 py-1 rounded-full ${effectiveShield ? 'text-[#050505] bg-[#020202]' : 'text-indigo-400 bg-indigo-500/10'}`}>
                      {s.title}
                    </span>
                    <p className={`text-[11px] leading-relaxed mt-3 line-clamp-3 ${effectiveShield ? 'text-[#060606]' : 'text-slate-500 group-hover:text-slate-300'}`}>
                      "{s.content}"
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        )}
      </main>

      <footer className={`h-10 border-t ${borderColor} bg-black/80 px-10 flex items-center justify-between text-[8px] font-black uppercase tracking-[0.5em] ${subTextColor}`}>
        <div className="flex items-center space-x-10">
          <span className="flex items-center space-x-2">
            <Activity className="w-3 h-3" />
            <span>LATENCY: 1.2S</span>
          </span>
          <span className="flex items-center space-x-2">
            <Shield className={`w-3 h-3 ${effectiveShield ? 'text-emerald-500' : ''}`} />
            <span>STEALTH GUARD: {effectiveShield ? 'ACTIVE' : (isAutoStealth ? 'MONITORING' : 'OFF')}</span>
          </span>
        </div>
        <div className="flex items-center space-x-6">
          <span className={`flex items-center space-x-2 ${status === 'connected' ? 'text-emerald-500' : 'text-rose-500'}`}>
            <Mic className="w-3 h-3" />
            <span>STATUS: {status.toUpperCase()}</span>
          </span>
          <span>ST: 2025.SENTINEL</span>
        </div>
      </footer>
    </div>
  );
};

export default App;
