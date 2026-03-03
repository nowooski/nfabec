import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Users, MapPin, ClipboardList, BarChart3, LogOut, Plus, Search, Filter,
  Upload, ChevronRight, ChevronDown, Check, X, Home, Phone, Star,
  UserCheck, Flag, AlertTriangle, Menu, ArrowLeft, Hash, Eye, Printer,
  Edit2, Trash2, Download, RefreshCw, CheckCircle, Circle, Clock
} from "lucide-react";

// ─── CONSTANTS ────────────────────────────────────────────
const STORAGE_KEYS = {
  voters: "ec-canvass:voters",
  users: "ec-canvass:users",
  walkLists: "ec-canvass:walkLists",
  contactLogs: "ec-canvass:contactLogs",
  session: "ec-canvass:session",
};

const SUPPORT_COLORS = {
  1: "#16a34a", 2: "#65a30d", 3: "#ca8a04", 4: "#ea580c", 5: "#dc2626",
};
const SUPPORT_LABELS = {
  1: "Strong Support", 2: "Lean Support", 3: "Undecided", 4: "Lean Oppose", 5: "Strong Oppose",
};

const DEFAULT_ADMIN = { id: "admin-1", username: "admin", pin: "1234", role: "admin", name: "Campaign Manager" };

// ─── STORAGE HELPERS ──────────────────────────────────────
async function loadData(key, fallback = []) {
  try {
    const r = localStorage.getItem(key);
    return r ? JSON.parse(r) : fallback;
  } catch { return fallback; }
}
async function saveData(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) { console.error("Save error:", e); }
}

function generateId(prefix = "id") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── CSV PARSER ───────────────────────────────────────────
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_"));
  return lines.slice(1).map(line => {
    const vals = parseCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (vals[i] || "").trim(); });
    return obj;
  }).filter(row => Object.values(row).some(v => v));
}

function parseCSVLine(line) {
  const result = [];
  let current = "", inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else current += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { result.push(current); current = ""; }
      else current += ch;
    }
  }
  result.push(current);
  return result;
}

// Detect election history columns from CSV headers
// NOTE: Headers have been sanitized: lowercased, non-alphanumeric replaced with _
// So "11/08/2022 General" becomes "11_08_2022_general"
// And "06/07/2022" becomes "06_07_2022"
function detectElectionColumns(headers) {
  return headers.filter(h => {
    // Date-like with election type: "11_08_2022_general", "06_07_2022_primary"
    if (/^\d{1,2}_\d{1,2}_\d{2,4}.*(?:general|primary|special|runoff|municipal|election|recall)/i.test(h)) return true;
    // Election type with date: "general_11_08_2022"
    if (/(?:general|primary|special|runoff|municipal|election|recall).*\d{1,2}_\d{1,2}_\d{2,4}/i.test(h)) return true;
    // Year-based: "2022_general", "2020_primary", "general_2022"
    if (/(?:20\d{2}|19\d{2})_(?:gen|pri|spe|run|mun|ele|rec)/i.test(h)) return true;
    if (/(?:gen|pri|spe|run|mun|ele|rec).*(?:20\d{2}|19\d{2})/i.test(h)) return true;
    // Pure date columns: "11_08_2022", "06_07_2022", "11_03_2020"
    if (/^\d{1,2}_\d{1,2}_\d{4}$/.test(h)) return true;
    // Shorter date: "11_08_22"
    if (/^\d{1,2}_\d{1,2}_\d{2}$/.test(h)) return true;
    // Vote history columns
    if (/vote.*hist|election.*hist|ballot.*type|voting.*method/i.test(h)) return true;
    return false;
  });
}

// ─── MAP HELPERS ──────────────────────────────────────────
// Determine if a voter file value means the voter voted in that election
function didVote(value) {
  if (!value || value.trim() === "") return false;
  const v = value.trim().toLowerCase();
  // These mean "did not vote"
  if (v === "n" || v === "no" || v === "0" || v === "-" || v === "none") return false;
  // Anything else (Y, Yes, A, Absentee, Mail, EV, P, Polling, etc.) means voted
  return true;
}

function normalizeStreet(addr) {
  if (!addr) return "";
  let s = addr.trim();
  // Remove house/unit number at start
  s = s.replace(/^\d+[-\s]?\d*\s*/, "");
  // Remove unit/apt/suite at end (e.g. "Apt 2", "#3", "Unit B")
  s = s.replace(/\s*[,#]\s*\d+.*$/i, "");
  s = s.replace(/\s+(apt|unit|suite|ste|spc|space|lot|bldg|building|fl|floor)\s*[#.]?\s*\w*$/i, "");
  // Remove street suffix
  s = s.replace(/\s+(st|street|ave|avenue|blvd|boulevard|dr|drive|ct|court|pl|place|way|ln|lane|rd|road|cir|circle|ter|terrace|pkwy|parkway|hwy|highway|path|trail|trl|loop|walk|row|run|pass|xing|crossing|crescent|cres)\.?\s*$/i, "");
  // Remove directional prefix/suffix
  s = s.replace(/\s+(n|s|e|w|ne|nw|se|sw|north|south|east|west)\.?\s*$/i, "");
  s = s.replace(/^(n|s|e|w|ne|nw|se|sw|north|south|east|west)\.?\s+/i, "");
  return s.trim().toLowerCase();
}

function getStreetNumber(addr) {
  const m = (addr || "").match(/^(\d+)/);
  return m ? parseInt(m[1]) : 0;
}

// ─── SIMPLE SVG MAP COMPONENT ─────────────────────────────
function WalkListMap({ voters, contactLogs }) {
  if (!voters || voters.length === 0) return null;

  const streets = {};
  voters.forEach(v => {
    const st = normalizeStreet(v.address);
    if (!streets[st]) streets[st] = [];
    streets[st].push(v);
  });

  const streetNames = Object.keys(streets).sort();
  const h = Math.max(300, streetNames.length * 60 + 40);
  const w = 700;

  const contactedIds = new Set(contactLogs.map(c => c.voterId));

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ maxHeight: 500, background: "#f8f7f4" }}>
      <defs>
        <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e5e2db" strokeWidth="0.5"/>
        </pattern>
      </defs>
      <rect width={w} height={h} fill="url(#grid)" />
      {streetNames.map((st, si) => {
        const y = 30 + si * 60;
        const addrs = streets[st].sort((a, b) => getStreetNumber(a.address) - getStreetNumber(b.address));
        const maxNum = Math.max(...addrs.map(v => getStreetNumber(v.address)), 1);
        const minNum = Math.min(...addrs.map(v => getStreetNumber(v.address)), 0);
        const range = maxNum - minNum || 1;

        return (
          <g key={st}>
            <line x1={60} y1={y + 15} x2={w - 20} y2={y + 15} stroke="#9c9585" strokeWidth="3" strokeLinecap="round" />
            <text x={10} y={y + 10} fontSize="8" fill="#6b6560" fontFamily="monospace" fontWeight="600">
              {st.slice(0, 10).toUpperCase()}
            </text>
            {addrs.map((v, vi) => {
              const num = getStreetNumber(v.address);
              const xPos = 80 + ((num - minNum) / range) * (w - 120);
              const contacted = contactedIds.has(v.id);
              const score = v.supportScore;
              const color = score ? SUPPORT_COLORS[score] : (contacted ? "#6b7280" : "#d1d5db");
              return (
                <g key={v.id}>
                  <rect x={xPos - 6} y={y + 6} width={12} height={18} rx={2}
                    fill={contacted ? color : "white"} stroke={color} strokeWidth="1.5" />
                  <text x={xPos} y={y + 18} fontSize="6" fill={contacted ? "white" : color}
                    textAnchor="middle" fontFamily="monospace" fontWeight="700">
                    {num}
                  </text>
                  {v.doNotContact && (
                    <line x1={xPos - 5} y1={y + 7} x2={xPos + 5} y2={y + 23} stroke="#dc2626" strokeWidth="1.5" />
                  )}
                  {v.yardSign && (
                    <circle cx={xPos + 7} cy={y + 7} r={2.5} fill="#16a34a" />
                  )}
                </g>
              );
            })}
          </g>
        );
      })}
      <g transform={`translate(${w - 180}, ${h - 50})`}>
        <rect width="170" height="45" rx="4" fill="white" stroke="#d1d5db" />
        <text x="8" y="12" fontSize="7" fontWeight="700" fill="#374151" fontFamily="monospace">LEGEND</text>
        {[1,2,3,4,5].map((s, i) => (
          <g key={s}>
            <rect x={8 + i * 32} y={18} width={10} height={10} rx={1} fill={SUPPORT_COLORS[s]} />
            <text x={20 + i * 32} y={26} fontSize="6" fill="#6b7280" fontFamily="monospace">{s}</text>
          </g>
        ))}
        <rect x={8} y={32} width={10} height={10} rx={1} fill="white" stroke="#d1d5db" />
        <text x={22} y={40} fontSize="6" fill="#6b7280" fontFamily="monospace">Not contacted</text>
      </g>
    </svg>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────
export default function CampaignCanvassApp() {
  // State
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null); // { userId, role, name }
  const [voters, setVoters] = useState([]);
  const [users, setUsers] = useState([]);
  const [walkLists, setWalkLists] = useState([]);
  const [contactLogs, setContactLogs] = useState([]);
  const [view, setView] = useState("dashboard");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Sub-view state
  const [selectedWalkList, setSelectedWalkList] = useState(null);
  const [selectedVoter, setSelectedVoter] = useState(null);
  const [editingVoter, setEditingVoter] = useState(null);

  // Load data on mount
  useEffect(() => {
    (async () => {
      const [v, u, wl, cl, s] = await Promise.all([
        loadData(STORAGE_KEYS.voters),
        loadData(STORAGE_KEYS.users, [DEFAULT_ADMIN]),
        loadData(STORAGE_KEYS.walkLists),
        loadData(STORAGE_KEYS.contactLogs),
        loadData(STORAGE_KEYS.session, null),
      ]);
      setVoters(v);
      setUsers(u.length ? u : [DEFAULT_ADMIN]);
      setWalkLists(wl);
      setContactLogs(cl);
      setSession(s);
      if (!u.length) await saveData(STORAGE_KEYS.users, [DEFAULT_ADMIN]);
      setLoading(false);
    })();
  }, []);

  // Save helpers
  const updateVoters = useCallback(async (newVoters) => {
    setVoters(newVoters);
    await saveData(STORAGE_KEYS.voters, newVoters);
  }, []);
  const updateUsers = useCallback(async (newUsers) => {
    setUsers(newUsers);
    await saveData(STORAGE_KEYS.users, newUsers);
  }, []);
  const updateWalkLists = useCallback(async (newLists) => {
    setWalkLists(newLists);
    await saveData(STORAGE_KEYS.walkLists, newLists);
  }, []);
  const updateContactLogs = useCallback(async (newLogs) => {
    setContactLogs(newLogs);
    await saveData(STORAGE_KEYS.contactLogs, newLogs);
  }, []);
  const updateSession = useCallback(async (s) => {
    setSession(s);
    await saveData(STORAGE_KEYS.session, s);
  }, []);

  // ─── LOGIN SCREEN ────────────────────────────────────────
  if (!session && !loading) {
    return <LoginScreen users={users} onLogin={updateSession} />;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen" style={{ background: "#1a1915", color: "#f5f0e8" }}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-amber-500 border-t-transparent mx-auto mb-4" />
          <p style={{ fontFamily: "monospace", letterSpacing: 2 }}>LOADING CAMPAIGN DATA...</p>
        </div>
      </div>
    );
  }

  const isAdmin = session.role === "admin";
  const isVolunteer = session.role === "volunteer";

  // Volunteer gets mobile canvasser view
  if (isVolunteer) {
    return (
      <MobileCanvasserView
        session={session}
        voters={voters}
        walkLists={walkLists.filter(wl => wl.volunteerId === session.userId)}
        contactLogs={contactLogs}
        onUpdateVoter={async (updatedVoter) => {
          const newVoters = voters.map(v => v.id === updatedVoter.id ? updatedVoter : v);
          await updateVoters(newVoters);
        }}
        onAddContactLog={async (log) => {
          await updateContactLogs([...contactLogs, log]);
        }}
        onLogout={() => updateSession(null)}
      />
    );
  }

  // Admin views
  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: BarChart3 },
    { id: "voters", label: "Voters", icon: Users },
    { id: "walklists", label: "Walk Lists", icon: MapPin },
    { id: "reports", label: "Reports", icon: ClipboardList },
    { id: "team", label: "Team", icon: UserCheck },
    { id: "canvass", label: "Canvass Mode", icon: Phone },
  ];

  return (
    <div className="flex min-h-screen" style={{ background: "#f8f7f4", fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>
      {/* Sidebar */}
      <div className="hidden md:flex flex-col w-56 border-r" style={{ background: "#1a1915", borderColor: "#2d2a23" }}>
        <div className="p-4 border-b" style={{ borderColor: "#2d2a23" }}>
          <h1 className="text-sm font-bold tracking-widest" style={{ color: "#e8a838", fontFamily: "monospace" }}>
            EC CANVASS
          </h1>
          <p className="text-xs mt-1" style={{ color: "#8a8477" }}>El Cerrito Campaign</p>
        </div>
        <nav className="flex-1 py-2">
          {navItems.map(item => {
            const Icon = item.icon;
            const active = view === item.id;
            return (
              <button key={item.id} onClick={() => { setView(item.id); setSelectedWalkList(null); setSelectedVoter(null); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-all"
                style={{
                  color: active ? "#e8a838" : "#a09a8e",
                  background: active ? "#2d2a23" : "transparent",
                  borderRight: active ? "2px solid #e8a838" : "2px solid transparent",
                }}>
                <Icon size={16} /> {item.label}
              </button>
            );
          })}
        </nav>
        <div className="p-3 border-t" style={{ borderColor: "#2d2a23" }}>
          <div className="flex items-center justify-between">
            <span className="text-xs" style={{ color: "#8a8477" }}>{session.name}</span>
            <button onClick={() => updateSession(null)} className="p-1 rounded" style={{ color: "#8a8477" }}>
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Mobile header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-3" style={{ background: "#1a1915" }}>
        <h1 className="text-sm font-bold tracking-widest" style={{ color: "#e8a838", fontFamily: "monospace" }}>EC CANVASS</h1>
        <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} style={{ color: "#a09a8e" }}><Menu size={20} /></button>
      </div>
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-40 pt-12" style={{ background: "#1a1915" }}>
          {navItems.map(item => {
            const Icon = item.icon;
            return (
              <button key={item.id} onClick={() => { setView(item.id); setMobileMenuOpen(false); }}
                className="w-full flex items-center gap-3 px-6 py-4 text-left"
                style={{ color: view === item.id ? "#e8a838" : "#a09a8e" }}>
                <Icon size={18} /> {item.label}
              </button>
            );
          })}
          <button onClick={() => { updateSession(null); setMobileMenuOpen(false); }}
            className="w-full flex items-center gap-3 px-6 py-4 text-left" style={{ color: "#8a8477" }}>
            <LogOut size={18} /> Sign Out
          </button>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 md:p-6 p-4 pt-16 md:pt-6 overflow-auto">
        {view === "dashboard" && (
          <DashboardView voters={voters} walkLists={walkLists} contactLogs={contactLogs} users={users} />
        )}
        {view === "voters" && (
          <VoterDatabaseView
            voters={voters}
            contactLogs={contactLogs}
            onUpdateVoters={updateVoters}
            selectedVoter={selectedVoter}
            onSelectVoter={setSelectedVoter}
            editingVoter={editingVoter}
            onEditVoter={setEditingVoter}
          />
        )}
        {view === "walklists" && (
          <WalkListView
            voters={voters}
            users={users}
            walkLists={walkLists}
            contactLogs={contactLogs}
            onUpdateWalkLists={updateWalkLists}
            selected={selectedWalkList}
            onSelect={setSelectedWalkList}
          />
        )}
        {view === "reports" && (
          <ReportsView voters={voters} walkLists={walkLists} contactLogs={contactLogs} users={users} />
        )}
        {view === "team" && (
          <TeamView users={users} onUpdateUsers={updateUsers} walkLists={walkLists} contactLogs={contactLogs} />
        )}
        {view === "canvass" && (
          <div>
            <h2 className="text-lg font-bold mb-2" style={{ color: "#1a1915", fontFamily: "monospace", letterSpacing: 1 }}>CANVASS MODE</h2>
            <p className="text-sm mb-4" style={{ color: "#8a8477" }}>
              This is the mobile door-knocking interface that volunteers see when they log in.
              You can also use it here to enter results directly. On a phone, log in as a volunteer to get this full-screen.
            </p>
            <div className="rounded-lg overflow-hidden mx-auto" style={{ maxWidth: 430, border: "3px solid #2d2a23", borderRadius: 16 }}>
              <MobileCanvasserView
                session={session}
                voters={voters}
                walkLists={walkLists}
                contactLogs={contactLogs}
                onUpdateVoter={async (updatedVoter) => {
                  const nv = voters.map(v => v.id === updatedVoter.id ? updatedVoter : v);
                  await updateVoters(nv);
                }}
                onAddContactLog={async (log) => {
                  await updateContactLogs([...contactLogs, log]);
                }}
                onLogout={() => setView("dashboard")}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── LOGIN SCREEN ─────────────────────────────────────────
function LoginScreen({ users, onLogin }) {
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  const handleLogin = () => {
    const user = users.find(u => u.username.toLowerCase() === username.toLowerCase() && u.pin === pin);
    if (user) {
      onLogin({ userId: user.id, role: user.role, name: user.name });
    } else {
      setError("Invalid credentials. Try again.");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#1a1915" }}>
      <div className="w-full max-w-sm p-8">
        <div className="text-center mb-8">
          <h1 className="text-xl font-bold tracking-widest mb-1" style={{ color: "#e8a838", fontFamily: "monospace" }}>
            EC CANVASS
          </h1>
          <p className="text-sm" style={{ color: "#8a8477" }}>El Cerrito Campaign Tool</p>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1.5 tracking-wide" style={{ color: "#a09a8e", fontFamily: "monospace" }}>
              USERNAME
            </label>
            <input value={username} onChange={e => { setUsername(e.target.value); setError(""); }}
              className="w-full px-3 py-2.5 rounded text-sm outline-none"
              style={{ background: "#2d2a23", color: "#f5f0e8", border: "1px solid #3d3a33" }}
              placeholder="Enter username" onKeyDown={e => e.key === "Enter" && handleLogin()} />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5 tracking-wide" style={{ color: "#a09a8e", fontFamily: "monospace" }}>
              PIN
            </label>
            <input type="password" value={pin} onChange={e => { setPin(e.target.value); setError(""); }}
              className="w-full px-3 py-2.5 rounded text-sm outline-none"
              style={{ background: "#2d2a23", color: "#f5f0e8", border: "1px solid #3d3a33" }}
              placeholder="Enter PIN" onKeyDown={e => e.key === "Enter" && handleLogin()} />
          </div>
          {error && <p className="text-xs" style={{ color: "#dc2626" }}>{error}</p>}
          <button onClick={handleLogin}
            className="w-full py-2.5 rounded text-sm font-semibold transition-all"
            style={{ background: "#e8a838", color: "#1a1915" }}>
            Sign In
          </button>
          <p className="text-xs text-center" style={{ color: "#6b6560" }}>
            Default admin: admin / 1234
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────
function DashboardView({ voters, walkLists, contactLogs, users }) {
  const contacted = voters.filter(v => contactLogs.some(c => c.voterId === v.id));
  const scores = {};
  voters.forEach(v => { if (v.supportScore) scores[v.supportScore] = (scores[v.supportScore] || 0) + 1; });
  const yardSigns = voters.filter(v => v.yardSign).length;
  const dnc = voters.filter(v => v.doNotContact).length;
  const activeVolunteers = users.filter(u => u.role === "volunteer").length;

  const stats = [
    { label: "Total Voters", value: voters.length, icon: Users, color: "#e8a838" },
    { label: "Contacted", value: contacted.length, icon: CheckCircle, color: "#16a34a" },
    { label: "% Contacted", value: voters.length ? Math.round(contacted.length / voters.length * 100) + "%" : "0%", icon: BarChart3, color: "#3b82f6" },
    { label: "Walk Lists", value: walkLists.length, icon: MapPin, color: "#8b5cf6" },
    { label: "Yard Signs", value: yardSigns, icon: Flag, color: "#16a34a" },
    { label: "DNC", value: dnc, icon: AlertTriangle, color: "#dc2626" },
    { label: "Volunteers", value: activeVolunteers, icon: UserCheck, color: "#06b6d4" },
    { label: "Total Knocks", value: contactLogs.length, icon: Home, color: "#ea580c" },
  ];

  return (
    <div>
      <h2 className="text-lg font-bold mb-4" style={{ color: "#1a1915", fontFamily: "monospace", letterSpacing: 1 }}>
        DASHBOARD
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {stats.map(s => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="rounded-lg p-4" style={{ background: "white", border: "1px solid #e5e2db" }}>
              <div className="flex items-center gap-2 mb-2">
                <Icon size={14} style={{ color: s.color }} />
                <span className="text-xs" style={{ color: "#8a8477", fontFamily: "monospace" }}>{s.label.toUpperCase()}</span>
              </div>
              <p className="text-2xl font-bold" style={{ color: "#1a1915" }}>{s.value}</p>
            </div>
          );
        })}
      </div>

      {/* Support score breakdown */}
      <div className="rounded-lg p-4 mb-4" style={{ background: "white", border: "1px solid #e5e2db" }}>
        <h3 className="text-xs font-bold mb-3" style={{ color: "#8a8477", fontFamily: "monospace", letterSpacing: 1 }}>
          SUPPORT SCORE DISTRIBUTION
        </h3>
        <div className="flex gap-2 items-end" style={{ height: 120 }}>
          {[1,2,3,4,5].map(s => {
            const count = scores[s] || 0;
            const max = Math.max(...Object.values(scores), 1);
            const pct = (count / max) * 100;
            return (
              <div key={s} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-xs font-bold" style={{ color: "#4b4840" }}>{count}</span>
                <div className="w-full rounded-t" style={{ height: `${Math.max(pct, 4)}%`, background: SUPPORT_COLORS[s], minHeight: 4 }} />
                <span className="text-xs font-bold" style={{ color: SUPPORT_COLORS[s] }}>{s}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent activity */}
      <div className="rounded-lg p-4" style={{ background: "white", border: "1px solid #e5e2db" }}>
        <h3 className="text-xs font-bold mb-3" style={{ color: "#8a8477", fontFamily: "monospace", letterSpacing: 1 }}>
          RECENT ACTIVITY
        </h3>
        {contactLogs.length === 0 ? (
          <p className="text-sm" style={{ color: "#8a8477" }}>No canvassing activity yet.</p>
        ) : (
          <div className="space-y-2">
            {contactLogs.slice(-10).reverse().map((log, i) => {
              const voter = voters.find(v => v.id === log.voterId);
              return (
                <div key={i} className="flex items-center gap-3 text-sm py-1.5 border-b" style={{ borderColor: "#f0ede6" }}>
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                    style={{ background: log.supportScore ? SUPPORT_COLORS[log.supportScore] : "#9ca3af" }}>
                    {log.supportScore || "?"}
                  </div>
                  <span style={{ color: "#4b4840" }}>{voter ? `${voter.firstName} ${voter.lastName}` : "Unknown"}</span>
                  <span className="text-xs ml-auto" style={{ color: "#a09a8e" }}>
                    {log.contactedBy} · {new Date(log.timestamp).toLocaleDateString()}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── VOTER DATABASE ───────────────────────────────────────
function VoterDatabaseView({ voters, contactLogs, onUpdateVoters, selectedVoter, onSelectVoter, editingVoter, onEditVoter }) {
  const [search, setSearch] = useState("");
  const [filterParty, setFilterParty] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterScore, setFilterScore] = useState("");
  const [filterElections, setFilterElections] = useState({}); // { electionName: "voted" | "not_voted" }
  const [showImport, setShowImport] = useState(false);
  const [importMapping, setImportMapping] = useState(null);
  const [importPreview, setImportPreview] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [showElectionFilter, setShowElectionFilter] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const fileRef = useRef(null);

  const contactedIds = useMemo(() => new Set(contactLogs.map(c => c.voterId)), [contactLogs]);
  
  // Get all available elections from voter data
  const allElections = useMemo(() => {
    const elecs = new Set();
    voters.forEach(v => {
      if (v.elections) Object.keys(v.elections).forEach(e => elecs.add(e));
    });
    return [...elecs].sort((a, b) => b.localeCompare(a)); // newest first
  }, [voters]);

  const activeElectionFilters = Object.keys(filterElections).filter(k => filterElections[k]);

  const filtered = useMemo(() => {
    return voters.filter(v => {
      if (search) {
        const s = search.toLowerCase();
        const match = [v.firstName, v.lastName, v.address, v.precinct, v.party]
          .some(f => (f || "").toLowerCase().includes(s));
        if (!match) return false;
      }
      if (filterParty && v.party !== filterParty) return false;
      if (filterStatus === "contacted" && !contactedIds.has(v.id)) return false;
      if (filterStatus === "not_contacted" && contactedIds.has(v.id)) return false;
      if (filterStatus === "dnc" && !v.doNotContact) return false;
      if (filterScore && v.supportScore !== parseInt(filterScore)) return false;
      // Election-specific filters: voter must match ALL checked elections
      for (const [elec, mode] of Object.entries(filterElections)) {
        if (!mode) continue;
        const val = v.elections?.[elec];
        const voted = didVote(val);
        if (mode === "voted" && !voted) return false;
        if (mode === "not_voted" && voted) return false;
      }
      return true;
    });
  }, [voters, search, filterParty, filterStatus, filterScore, contactedIds]);

  const parties = useMemo(() => [...new Set(voters.map(v => v.party).filter(Boolean))], [voters]);

  // CSV Import
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const rows = parseCSV(ev.target.result);
      if (rows.length === 0) return;
      const headers = Object.keys(rows[0]);
      const electionCols = detectElectionColumns(headers);
      // Auto-detect mapping
      const mapping = {
        firstName: headers.find(h => /first.?name|fname/i.test(h)) || "",
        lastName: headers.find(h => /last.?name|lname|surname/i.test(h)) || "",
        address: headers.find(h => /address|street|res.?addr|residence/i.test(h)) || "",
        city: headers.find(h => /city|town/i.test(h)) || "",
        zip: headers.find(h => /zip|postal/i.test(h)) || "",
        party: headers.find(h => /party|affiliation|reg/i.test(h)) || "",
        precinct: headers.find(h => /precinct|pct|district/i.test(h)) || "",
        phone: headers.find(h => /phone|tel/i.test(h)) || "",
        email: headers.find(h => /email|e.?mail/i.test(h)) || "",
        voterId: headers.find(h => /voter.?id|reg.?id/i.test(h)) || headers.find(h => h === "id") || "",
      };
      setImportMapping({ headers, mapping, rows, electionCols });
      setImportPreview(rows.slice(0, 5));
      setShowImport(true);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const doImport = () => {
    if (!importMapping) return;
    const { mapping, rows, electionCols } = importMapping;
    
    // Build lookup of existing voters by externalVoterId for deduplication
    const existingByExtId = {};
    voters.forEach(v => {
      if (v.externalVoterId) existingByExtId[v.externalVoterId] = v;
    });
    
    let updatedCount = 0;
    let newCount = 0;
    const updatedVoterIds = new Set();
    
    const incomingVoters = rows.map(row => {
      const elections = {};
      (electionCols || []).forEach(col => {
        elections[col] = row[col] || "";
      });
      const extId = row[mapping.voterId] || "";
      const voterData = {
        firstName: row[mapping.firstName] || "",
        lastName: row[mapping.lastName] || "",
        address: row[mapping.address] || "",
        city: row[mapping.city] || "El Cerrito",
        zip: row[mapping.zip] || "",
        party: row[mapping.party] || "",
        precinct: row[mapping.precinct] || "",
        phone: row[mapping.phone] || "",
        email: row[mapping.email] || "",
        externalVoterId: extId,
        elections,
      };
      
      // If voter already exists (by registration number), update them
      if (extId && existingByExtId[extId]) {
        const existing = existingByExtId[extId];
        updatedVoterIds.add(existing.id);
        updatedCount++;
        return {
          ...existing,
          ...voterData,
          id: existing.id,
          // Preserve canvassing data
          supportScore: existing.supportScore,
          yardSign: existing.yardSign,
          doNotContact: existing.doNotContact,
          notes: existing.notes,
          importedAt: existing.importedAt,
          updatedAt: new Date().toISOString(),
        };
      } else {
        newCount++;
        return {
          ...voterData,
          id: generateId("voter"),
          supportScore: null,
          yardSign: false,
          doNotContact: false,
          notes: "",
          importedAt: new Date().toISOString(),
        };
      }
    });
    
    // Merge: keep existing voters not in import, update those that match, add new ones
    const mergedVoters = voters.filter(v => !updatedVoterIds.has(v.id));
    const finalVoters = [...mergedVoters, ...incomingVoters];
    
    onUpdateVoters(finalVoters);
    setShowImport(false);
    setImportMapping(null);
    setImportPreview(null);
    setImportResult({ updated: updatedCount, added: newCount });
    setTimeout(() => setImportResult(null), 5000);
  };

  // Voter detail/edit modal
  if (editingVoter) {
    return (
      <VoterEditor
        voter={editingVoter}
        onSave={(updated) => {
          const newVoters = voters.map(v => v.id === updated.id ? updated : v);
          onUpdateVoters(newVoters);
          onEditVoter(null);
        }}
        onCancel={() => onEditVoter(null)}
      />
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-lg font-bold" style={{ color: "#1a1915", fontFamily: "monospace", letterSpacing: 1 }}>
          VOTER DATABASE <span className="text-sm font-normal" style={{ color: "#8a8477" }}>({filtered.length} of {voters.length})</span>
        </h2>
        <div className="flex gap-2">
          <input type="file" ref={fileRef} accept=".csv" onChange={handleFileUpload} className="hidden" />
          <button onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold"
            style={{ background: "#e8a838", color: "#1a1915" }}>
            <Upload size={13} /> Import CSV
          </button>
          {voters.length > 0 && (
            <button onClick={() => {
              if (confirm("This will remove ALL voters and let you re-import from scratch. Walk lists and contact logs will be preserved. Continue?")) {
                onUpdateVoters([]);
              }
            }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs"
              style={{ border: "1px solid #e5e2db", color: "#dc2626" }}>
              <Trash2 size={13} /> Clear All Voters
            </button>
          )}
        </div>
      </div>

      {/* Import Modal */}
      {showImport && importMapping && (
        <div className="rounded-lg p-4 mb-4" style={{ background: "white", border: "2px solid #e8a838" }}>
          <h3 className="text-sm font-bold mb-3" style={{ fontFamily: "monospace", color: "#1a1915" }}>MAP CSV COLUMNS</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
            {Object.entries(importMapping.mapping).map(([field, val]) => (
              <div key={field}>
                <label className="block text-xs mb-1" style={{ color: "#8a8477", fontFamily: "monospace" }}>{field}</label>
                <select value={val} onChange={e => setImportMapping({ ...importMapping, mapping: { ...importMapping.mapping, [field]: e.target.value }})}
                  className="w-full px-2 py-1 rounded text-xs"
                  style={{ border: "1px solid #e5e2db", background: "#f8f7f4" }}>
                  <option value="">-- skip --</option>
                  {importMapping.headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
          </div>
          {/* Election history columns - interactive picker */}
          <div className="mb-3 p-3 rounded" style={{ background: "#eff6ff", border: "1px solid #bfdbfe" }}>
            <p className="text-xs font-bold mb-1" style={{ color: "#1d4ed8", fontFamily: "monospace" }}>
              ELECTION HISTORY COLUMNS ({(importMapping.electionCols || []).length} selected)
            </p>
            <p className="text-xs mb-2" style={{ color: "#6b7280" }}>
              Check columns that represent election participation. Auto-detected columns are pre-checked.
            </p>
            <div className="flex flex-wrap gap-1 mb-1" style={{ maxHeight: 160, overflowY: "auto" }}>
              {importMapping.headers
                .filter(h => !Object.values(importMapping.mapping).includes(h))
                .map(col => {
                  const isSelected = (importMapping.electionCols || []).includes(col);
                  return (
                    <label key={col} className="flex items-center gap-1 text-xs px-1.5 py-1 rounded cursor-pointer"
                      style={{
                        background: isSelected ? "#dbeafe" : "#f3f4f6",
                        color: isSelected ? "#1e40af" : "#6b7280",
                        border: `1px solid ${isSelected ? "#93c5fd" : "#e5e7eb"}`,
                      }}>
                      <input type="checkbox" checked={isSelected} className="w-3 h-3"
                        onChange={() => {
                          const current = importMapping.electionCols || [];
                          const next = isSelected ? current.filter(c => c !== col) : [...current, col];
                          setImportMapping({ ...importMapping, electionCols: next });
                        }} />
                      {col.replace(/_/g, " ")}
                    </label>
                  );
                })}
            </div>
            {(importMapping.electionCols || []).length === 0 && (
              <p className="text-xs mt-1" style={{ color: "#ea580c" }}>
                No election columns detected automatically. Check any columns above that represent election vote history.
              </p>
            )}
          </div>
          {importPreview && (
            <div className="mb-3 overflow-x-auto">
              <p className="text-xs mb-1" style={{ color: "#8a8477" }}>Preview (first 5 rows):</p>
              <table className="text-xs w-full" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {Object.entries(importMapping.mapping).filter(([,v]) => v).map(([f]) => (
                      <th key={f} className="px-2 py-1 text-left" style={{ borderBottom: "1px solid #e5e2db", color: "#8a8477", fontFamily: "monospace" }}>{f}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {importPreview.map((row, i) => (
                    <tr key={i}>
                      {Object.entries(importMapping.mapping).filter(([,v]) => v).map(([f, col]) => (
                        <td key={f} className="px-2 py-1" style={{ borderBottom: "1px solid #f0ede6", color: "#4b4840" }}>{row[col]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={doImport} className="px-4 py-1.5 rounded text-xs font-semibold" style={{ background: "#16a34a", color: "white" }}>
              Import {importMapping.rows.length} Voters
            </button>
            <button onClick={() => { setShowImport(false); setImportMapping(null); }} className="px-4 py-1.5 rounded text-xs"
              style={{ border: "1px solid #e5e2db", color: "#8a8477" }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Import result banner */}
      {importResult && (
        <div className="rounded-lg p-3 mb-4 flex items-center gap-2" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
          <CheckCircle size={14} style={{ color: "#16a34a" }} />
          <span className="text-xs" style={{ color: "#166534" }}>
            Import complete: {importResult.added} new voter{importResult.added !== 1 ? "s" : ""} added
            {importResult.updated > 0 && `, ${importResult.updated} existing voter${importResult.updated !== 1 ? "s" : ""} updated (matched by registration #)`}
          </span>
        </div>
      )}

      {/* Search & Filters */}
      <div className="flex gap-2 mb-3 flex-wrap">
        <div className="flex-1 min-w-48 relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "#a09a8e" }} />
          <input value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded text-sm outline-none"
            style={{ border: "1px solid #e5e2db", background: "white" }}
            placeholder="Search name, address, precinct..." />
        </div>
        <button onClick={() => setShowFilters(!showFilters)} className="flex items-center gap-1.5 px-3 py-2 rounded text-xs"
          style={{ border: "1px solid #e5e2db", background: "white", color: "#4b4840" }}>
          <Filter size={13} /> Filters {(filterParty || filterStatus || filterScore || activeElectionFilters.length > 0) ? "•" : ""}
        </button>
      </div>

      {showFilters && (
        <div className="mb-3 space-y-2">
          <div className="flex gap-2 flex-wrap">
            <select value={filterParty} onChange={e => setFilterParty(e.target.value)}
              className="px-2 py-1.5 rounded text-xs" style={{ border: "1px solid #e5e2db" }}>
              <option value="">All Parties</option>
              {parties.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              className="px-2 py-1.5 rounded text-xs" style={{ border: "1px solid #e5e2db" }}>
              <option value="">All Status</option>
              <option value="contacted">Contacted</option>
              <option value="not_contacted">Not Contacted</option>
              <option value="dnc">Do Not Contact</option>
            </select>
            <select value={filterScore} onChange={e => setFilterScore(e.target.value)}
              className="px-2 py-1.5 rounded text-xs" style={{ border: "1px solid #e5e2db" }}>
              <option value="">All Scores</option>
              {[1,2,3,4,5].map(s => <option key={s} value={s}>{s} - {SUPPORT_LABELS[s]}</option>)}
            </select>
            {allElections.length > 0 && (
              <button onClick={() => setShowElectionFilter(!showElectionFilter)}
                className="px-2 py-1.5 rounded text-xs flex items-center gap-1"
                style={{ border: "1px solid #e5e2db", background: activeElectionFilters.length > 0 ? "#eff6ff" : "white", color: activeElectionFilters.length > 0 ? "#1d4ed8" : "#4b4840" }}>
                <Hash size={11} /> Elections {activeElectionFilters.length > 0 && `(${activeElectionFilters.length})`}
              </button>
            )}
            {(filterParty || filterStatus || filterScore || activeElectionFilters.length > 0) && (
              <button onClick={() => { setFilterParty(""); setFilterStatus(""); setFilterScore(""); setFilterElections({}); }}
                className="text-xs px-2" style={{ color: "#dc2626" }}>Clear All</button>
            )}
          </div>

          {/* Election filter checkboxes */}
          {showElectionFilter && allElections.length > 0 && (
            <div className="rounded-lg p-3" style={{ background: "white", border: "1px solid #bfdbfe" }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold" style={{ color: "#1d4ed8", fontFamily: "monospace" }}>FILTER BY ELECTION PARTICIPATION</span>
                {activeElectionFilters.length > 0 && (
                  <button onClick={() => setFilterElections({})} className="text-xs" style={{ color: "#dc2626" }}>Clear elections</button>
                )}
              </div>
              <p className="text-xs mb-2" style={{ color: "#6b7280" }}>Check elections to require voters voted in them. Shift+click to require they did NOT vote.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
                {allElections.map(elec => {
                  const mode = filterElections[elec]; // "voted", "not_voted", or undefined
                  return (
                    <div key={elec} className="flex items-center gap-2 py-1 px-2 rounded cursor-pointer"
                      style={{ background: mode === "voted" ? "#f0fdf4" : mode === "not_voted" ? "#fef2f2" : "transparent" }}
                      onClick={(e) => {
                        const next = { ...filterElections };
                        if (e.shiftKey) {
                          next[elec] = mode === "not_voted" ? undefined : "not_voted";
                        } else {
                          next[elec] = mode === "voted" ? undefined : "voted";
                        }
                        if (!next[elec]) delete next[elec];
                        setFilterElections(next);
                      }}>
                      <div className="w-4 h-4 rounded border flex items-center justify-center flex-shrink-0" style={{
                        borderColor: mode === "voted" ? "#16a34a" : mode === "not_voted" ? "#dc2626" : "#d1d5db",
                        background: mode === "voted" ? "#16a34a" : mode === "not_voted" ? "#dc2626" : "white",
                      }}>
                        {mode === "voted" && <Check size={10} color="white" />}
                        {mode === "not_voted" && <X size={10} color="white" />}
                      </div>
                      <span className="text-xs flex-1" style={{ color: mode ? "#1a1915" : "#6b7280" }}>
                        {elec.replace(/_/g, " ")}
                      </span>
                      {mode === "not_voted" && (
                        <span className="text-xs" style={{ color: "#dc2626" }}>didn't vote</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Voter Table */}
      <div className="rounded-lg overflow-hidden" style={{ border: "1px solid #e5e2db", background: "white" }}>
        <div className="overflow-x-auto" style={{ maxHeight: 500 }}>
          <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f4f2ed" }}>
                {["Name", "Address", "Party", "Precinct", "History", "Score", "Status", ""].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-xs font-semibold" style={{ color: "#8a8477", fontFamily: "monospace", borderBottom: "1px solid #e5e2db" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 100).map(v => {
                const contacted = contactedIds.has(v.id);
                return (
                  <tr key={v.id} className="cursor-pointer hover:bg-gray-50" style={{ borderBottom: "1px solid #f0ede6" }}
                    onClick={() => onEditVoter(v)}>
                    <td className="px-3 py-2 font-medium" style={{ color: "#1a1915" }}>
                      {v.firstName} {v.lastName}
                      {v.doNotContact && <span className="ml-1 text-xs px-1 rounded" style={{ background: "#fef2f2", color: "#dc2626" }}>DNC</span>}
                      {v.yardSign && <span className="ml-1 text-xs px-1 rounded" style={{ background: "#f0fdf4", color: "#16a34a" }}>SIGN</span>}
                    </td>
                    <td className="px-3 py-2" style={{ color: "#4b4840" }}>{v.address}</td>
                    <td className="px-3 py-2" style={{ color: "#4b4840" }}>{v.party}</td>
                    <td className="px-3 py-2" style={{ color: "#4b4840" }}>{v.precinct}</td>
                    <td className="px-3 py-2">
                      {v.elections && Object.keys(v.elections).length > 0 ? (() => {
                        const total = Object.keys(v.elections).length;
                        const voted = Object.values(v.elections).filter(val => didVote(val)).length;
                        return (
                          <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "#eff6ff", color: "#3b82f6", fontFamily: "monospace" }}>
                            {voted}/{total}
                          </span>
                        );
                      })() : <span style={{ color: "#d1d5db" }}>—</span>}
                    </td>
                    <td className="px-3 py-2">
                      {v.supportScore ? (
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white"
                          style={{ background: SUPPORT_COLORS[v.supportScore] }}>
                          {v.supportScore}
                        </div>
                      ) : <span style={{ color: "#d1d5db" }}>—</span>}
                    </td>
                    <td className="px-3 py-2">
                      {contacted ? (
                        <span className="text-xs font-medium" style={{ color: "#16a34a" }}>Contacted</span>
                      ) : (
                        <span className="text-xs" style={{ color: "#a09a8e" }}>Pending</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Edit2 size={13} style={{ color: "#a09a8e" }} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length > 100 && (
          <div className="px-3 py-2 text-xs text-center" style={{ color: "#8a8477", borderTop: "1px solid #e5e2db" }}>
            Showing first 100 of {filtered.length} results. Use search/filters to narrow.
          </div>
        )}
        {filtered.length === 0 && (
          <div className="px-3 py-8 text-center" style={{ color: "#8a8477" }}>
            {voters.length === 0 ? "No voters imported yet. Import a CSV to get started." : "No voters match current filters."}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── VOTER EDITOR ─────────────────────────────────────────
function VoterEditor({ voter, onSave, onCancel }) {
  const [form, setForm] = useState({ ...voter });
  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  return (
    <div>
      <button onClick={onCancel} className="flex items-center gap-1 text-sm mb-4" style={{ color: "#8a8477" }}>
        <ArrowLeft size={14} /> Back to list
      </button>
      <div className="rounded-lg p-5" style={{ background: "white", border: "1px solid #e5e2db" }}>
        <h3 className="text-sm font-bold mb-4" style={{ fontFamily: "monospace", color: "#1a1915", letterSpacing: 1 }}>
          EDIT VOTER
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          {[
            ["firstName", "First Name"], ["lastName", "Last Name"],
            ["address", "Address"], ["city", "City"],
            ["zip", "Zip"], ["party", "Party"],
            ["precinct", "Precinct"], ["phone", "Phone"],
            ["email", "Email"],
          ].map(([key, label]) => (
            <div key={key}>
              <label className="block text-xs mb-1" style={{ color: "#8a8477", fontFamily: "monospace" }}>{label}</label>
              <input value={form[key] || ""} onChange={e => set(key, e.target.value)}
                className="w-full px-3 py-2 rounded text-sm outline-none"
                style={{ border: "1px solid #e5e2db" }} />
            </div>
          ))}
        </div>

        <div className="mb-4">
          <label className="block text-xs mb-2" style={{ color: "#8a8477", fontFamily: "monospace" }}>SUPPORT SCORE</label>
          <div className="flex gap-2">
            {[1,2,3,4,5].map(s => (
              <button key={s} onClick={() => set("supportScore", form.supportScore === s ? null : s)}
                className="w-10 h-10 rounded-lg text-sm font-bold transition-all"
                style={{
                  background: form.supportScore === s ? SUPPORT_COLORS[s] : "white",
                  color: form.supportScore === s ? "white" : SUPPORT_COLORS[s],
                  border: `2px solid ${SUPPORT_COLORS[s]}`,
                }}>
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-4 mb-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: "#4b4840" }}>
            <input type="checkbox" checked={form.yardSign || false} onChange={e => set("yardSign", e.target.checked)} />
            Yard Sign Requested
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: "#4b4840" }}>
            <input type="checkbox" checked={form.doNotContact || false} onChange={e => set("doNotContact", e.target.checked)} />
            Do Not Contact
          </label>
        </div>

        {/* Election History */}
        {form.elections && Object.keys(form.elections).length > 0 ? (
          <div className="mb-4">
            <label className="block text-xs mb-2" style={{ color: "#8a8477", fontFamily: "monospace" }}>
              ELECTION HISTORY ({Object.entries(form.elections).filter(([, v]) => didVote(v)).length}/{Object.keys(form.elections).length} elections voted)
            </label>
            <div className="p-3 rounded" style={{ background: "#f8f7f4", border: "1px solid #e5e2db" }}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
                {Object.entries(form.elections).sort((a, b) => b[0].localeCompare(a[0])).map(([election, value]) => {
                  const voted = didVote(value);
                  return (
                    <div key={election} className="flex items-center gap-2 py-1 px-1 rounded" style={{ background: voted ? "#f0fdf4" : "transparent" }}>
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: voted ? "#16a34a" : "#d1d5db" }} />
                      <span className="text-xs flex-1 truncate" style={{ color: voted ? "#1a1915" : "#a09a8e" }} title={election}>
                        {election.replace(/_/g, " ")}
                      </span>
                      {value && value.trim().length > 0 && (
                        <span className="text-xs font-medium px-1 rounded" style={{
                          color: voted ? "#166534" : "#9ca3af",
                          background: voted ? "#dcfce7" : "#f3f4f6",
                        }}>{value}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="mb-4 p-3 rounded" style={{ background: "#fffbeb", border: "1px solid #fde68a" }}>
            <p className="text-xs" style={{ color: "#92400e" }}>
              No election history on this voter. {!form.elections ? "This voter was imported before election history tracking was added." : "The elections field is empty."} Re-import your voter file to populate election data — existing canvassing data will be preserved.
            </p>
          </div>
        )}

        <div className="mb-4">
          <label className="block text-xs mb-1" style={{ color: "#8a8477", fontFamily: "monospace" }}>NOTES</label>
          <textarea value={form.notes || ""} onChange={e => set("notes", e.target.value)} rows={3}
            className="w-full px-3 py-2 rounded text-sm outline-none"
            style={{ border: "1px solid #e5e2db" }} />
        </div>

        <div className="flex gap-2">
          <button onClick={() => onSave(form)} className="px-4 py-2 rounded text-sm font-semibold"
            style={{ background: "#e8a838", color: "#1a1915" }}>Save Changes</button>
          <button onClick={onCancel} className="px-4 py-2 rounded text-sm"
            style={{ border: "1px solid #e5e2db", color: "#8a8477" }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── WALK LIST VIEW ───────────────────────────────────────
function WalkListView({ voters, users, walkLists, contactLogs, onUpdateWalkLists, selected, onSelect }) {
  const [creating, setCreating] = useState(false);

  // ALL HOOKS must be called before any conditional returns
  const voterWalkListCounts = useMemo(() => {
    const counts = {};
    walkLists.forEach(wl => {
      wl.voterIds.forEach(vid => { counts[vid] = (counts[vid] || 0) + 1; });
    });
    return counts;
  }, [walkLists]);

  if (selected) {
    const wl = walkLists.find(w => w.id === selected);
    if (!wl) { onSelect(null); return null; }
    const wlVoters = wl.voterIds.map(vid => voters.find(v => v.id === vid)).filter(Boolean);
    const assignee = users.find(u => u.id === wl.volunteerId);
    const wlLogs = contactLogs.filter(c => wl.voterIds.includes(c.voterId));

    // Group by address
    const byAddress = {};
    wlVoters.forEach(v => {
      const addr = v.address || "Unknown";
      if (!byAddress[addr]) byAddress[addr] = [];
      byAddress[addr].push(v);
    });
    const sortedAddresses = Object.keys(byAddress).sort((a, b) => {
      const streetA = normalizeStreet(a), streetB = normalizeStreet(b);
      if (streetA !== streetB) return streetA.localeCompare(streetB);
      return getStreetNumber(a) - getStreetNumber(b);
    });

    return (
      <div>
        <button onClick={() => onSelect(null)} className="flex items-center gap-1 text-sm mb-4" style={{ color: "#8a8477" }}>
          <ArrowLeft size={14} /> All Walk Lists
        </button>
        <div className="rounded-lg p-5 mb-4" style={{ background: "white", border: "1px solid #e5e2db" }}>
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className="text-sm font-bold" style={{ fontFamily: "monospace", color: "#1a1915" }}>{wl.name}</h3>
              <p className="text-xs mt-1" style={{ color: "#8a8477" }}>
                {wlVoters.length} voters · {sortedAddresses.length} addresses · Assigned: {assignee?.name || "Unassigned"}
              </p>
              <p className="text-xs" style={{ color: "#8a8477" }}>
                Created: {new Date(wl.createdAt).toLocaleDateString()} · Contacted: {wlLogs.length}/{wlVoters.length}
              </p>
            </div>
            <button onClick={() => {
              const updated = walkLists.map(w => w.id === wl.id ? { ...w, status: w.status === "completed" ? "active" : "completed" } : w);
              onUpdateWalkLists(updated);
            }} className="px-3 py-1 rounded text-xs font-semibold"
              style={{ background: wl.status === "completed" ? "#e5e2db" : "#16a34a", color: wl.status === "completed" ? "#4b4840" : "white" }}>
              {wl.status === "completed" ? "Reopen" : "Mark Complete"}
            </button>
          </div>

          {/* Map */}
          <WalkListMap voters={wlVoters} contactLogs={wlLogs} />
        </div>

        {/* Walk Sheet Header + Print */}
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-bold" style={{ fontFamily: "monospace", color: "#8a8477", letterSpacing: 1 }}>WALK SHEET</span>
          <button onClick={() => {
            const printWin = window.open("", "_blank");
            if (!printWin) { alert("Please allow popups to print walk sheets."); return; }
            const tableRows = sortedAddresses.flatMap(addr => {
              const av = byAddress[addr];
              return av.map((v, i) => {
                const elecKeys = v.elections ? Object.keys(v.elections).sort((a, b) => b.localeCompare(a)).slice(0, 6) : [];
                const elecHtml = elecKeys.map(e => {
                  const voted = didVote(v.elections[e]);
                  return `<span style="color:${voted ? "#16a34a" : "#ccc"};margin-right:4px;">${e.replace(/_/g, "/").slice(0, 10)}:${voted ? "Y" : "-"}</span>`;
                }).join("");
                return `<tr style="border-bottom:1px solid #ddd;${i === 0 ? "border-top:2px solid #aaa;" : ""}">
                  <td style="padding:5px 6px;font-weight:${i === 0 ? "700" : "400"};background:${i === 0 ? "#f5f5f0" : "#fff"};white-space:nowrap;">
                    ${i === 0 ? addr : '<span style="color:#bbb;padding-left:10px">↳</span>'}
                  </td>
                  <td style="padding:5px 6px;white-space:nowrap;">${v.firstName} ${v.lastName}</td>
                  <td style="padding:5px 6px;color:#888;">${v.party || ""}</td>
                  <td style="padding:5px 4px;font-size:9px;">${elecHtml}</td>
                  <td style="padding:5px 4px;text-align:center;white-space:nowrap;">
                    ${[1, 2, 3, 4, 5].map(s => `<span style="display:inline-block;width:18px;height:18px;border:1.5px solid #aaa;border-radius:50%;text-align:center;line-height:18px;font-size:9px;font-weight:600;color:#999;margin:0 1px;">${s}</span>`).join("")}
                  </td>
                  <td style="padding:5px 6px;text-align:center;"><span style="display:inline-block;width:14px;height:14px;border:1.5px solid #aaa;border-radius:2px;"></span></td>
                  <td style="padding:5px 6px;text-align:center;"><span style="display:inline-block;width:14px;height:14px;border:1.5px solid #aaa;border-radius:2px;"></span></td>
                  <td style="padding:5px 6px;text-align:center;"><span style="display:inline-block;width:14px;height:14px;border:1.5px solid #aaa;border-radius:2px;"></span></td>
                  <td style="padding:5px 6px;"><span style="display:block;border-bottom:1px dotted #ccc;min-width:80px;height:16px;"></span></td>
                </tr>`;
              });
            }).join("\n");
            printWin.document.write(`<!DOCTYPE html><html><head><title>${wl.name}</title><style>
              @page { size: landscape; margin: 0.4in; }
              * { box-sizing: border-box; }
              body { font-family: "Courier New", monospace; font-size: 10px; color: #222; margin: 0; padding: 0; }
              table { width: 100%; border-collapse: collapse; page-break-inside: auto; }
              tr { page-break-inside: avoid; }
              th { padding: 5px 6px; text-align: left; border-bottom: 2px solid #333; font-size: 9px; text-transform: uppercase; color: #555; letter-spacing: 1px; }
              .hdr { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 6px; padding-bottom: 5px; border-bottom: 2px solid #333; }
              .hdr h1 { font-size: 15px; margin: 0; }
              .meta { font-size: 9px; color: #666; }
              .legend { font-size: 8px; color: #888; margin-top: 6px; }
              .no-print { position: fixed; top: 8px; right: 8px; z-index: 100; padding: 8px 20px; background: #e8a838; color: #1a1915; border: none; border-radius: 4px; font-weight: 700; cursor: pointer; font-family: monospace; font-size: 13px; }
              @media print { .no-print { display: none !important; } }
            </style></head><body>
              <button class="no-print" onclick="window.print()">PRINT</button>
              <div class="hdr">
                <div>
                  <h1>${wl.name}</h1>
                  <div class="meta">${wlVoters.length} voters &middot; ${sortedAddresses.length} addresses</div>
                  <div class="meta">Assigned: ${assignee?.name || "Unassigned"} &middot; Created ${new Date(wl.createdAt).toLocaleDateString()}</div>
                </div>
                <div style="text-align:right">
                  <div class="meta" style="font-weight:700;">EC CANVASS</div>
                  <div class="meta">Printed ${new Date().toLocaleDateString()}</div>
                </div>
              </div>
              <table><thead><tr>
                <th style="width:17%">Address</th>
                <th style="width:13%">Name</th>
                <th style="width:5%">Pty</th>
                <th style="width:18%">Vote History</th>
                <th style="width:15%;text-align:center">Support 1–5</th>
                <th style="width:4%;text-align:center">Sign</th>
                <th style="width:4%;text-align:center">DNC</th>
                <th style="width:4%;text-align:center">NH</th>
                <th style="width:16%">Notes</th>
              </tr></thead><tbody>${tableRows}</tbody></table>
              <div class="legend">Support: 1=Strong Support &middot; 2=Lean Support &middot; 3=Undecided &middot; 4=Lean Oppose &middot; 5=Strong Oppose &nbsp;&nbsp;|&nbsp;&nbsp; Sign=Yard Sign &nbsp;|&nbsp; DNC=Do Not Contact &nbsp;|&nbsp; NH=Not Home</div>
            </body></html>`);
            printWin.document.close();
          }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold"
            style={{ background: "#1a1915", color: "#e8a838" }}>
            <Printer size={13} /> Print Walk Sheet
          </button>
        </div>

        {/* Walk Sheet Table Preview */}
        <div className="rounded-lg overflow-hidden" style={{ border: "1px solid #e5e2db", background: "white" }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f4f2ed" }}>
                  {["Address", "Name", "Party", "History", "Score", "Status"].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-semibold"
                      style={{ color: "#8a8477", fontFamily: "monospace", borderBottom: "1px solid #e5e2db" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedAddresses.flatMap(addr => {
                  const addrVoters = byAddress[addr];
                  return addrVoters.map((v, i) => {
                    const log = contactLogs.find(c => c.voterId === v.id);
                    const elecCount = v.elections ? Object.keys(v.elections).length : 0;
                    const votedCount = v.elections ? Object.values(v.elections).filter(val => didVote(val)).length : 0;
                    return (
                      <tr key={v.id} style={{ borderBottom: "1px solid #f0ede6", borderTop: i === 0 ? "2px solid #e5e2db" : "none" }}>
                        <td className="px-3 py-1.5" style={{ background: i === 0 ? "#faf9f6" : "white" }}>
                          {i === 0 ? (
                            <span className="text-sm font-semibold" style={{ color: "#1a1915" }}>{addr}</span>
                          ) : (
                            <span className="text-xs pl-3" style={{ color: "#c4c0b8" }}>↳</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-sm" style={{ color: "#1a1915" }}>{v.firstName} {v.lastName}</td>
                        <td className="px-3 py-1.5 text-xs" style={{ color: "#8a8477" }}>{v.party}</td>
                        <td className="px-3 py-1.5">
                          {elecCount > 0 ? (
                            <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "#eff6ff", color: "#3b82f6", fontFamily: "monospace" }}>{votedCount}/{elecCount}</span>
                          ) : <span style={{ color: "#d1d5db" }}>—</span>}
                        </td>
                        <td className="px-3 py-1.5">
                          {v.supportScore ? (
                            <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white"
                              style={{ background: SUPPORT_COLORS[v.supportScore] }}>{v.supportScore}</div>
                          ) : <span style={{ color: "#d1d5db" }}>—</span>}
                        </td>
                        <td className="px-3 py-1.5">
                          {v.doNotContact ? <span className="text-xs px-1 rounded" style={{ background: "#fef2f2", color: "#dc2626" }}>DNC</span>
                            : v.yardSign ? <span className="text-xs px-1 rounded" style={{ background: "#f0fdf4", color: "#16a34a" }}>SIGN</span>
                            : log ? <CheckCircle size={14} style={{ color: "#16a34a" }} />
                            : <Circle size={14} style={{ color: "#d1d5db" }} />}
                        </td>
                      </tr>
                    );
                  });
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  if (creating) {
    return (
      <WalkListBuilder
        voters={voters}
        users={users}
        walkLists={walkLists}
        onSave={(newList) => {
          onUpdateWalkLists([...walkLists, newList]);
          setCreating(false);
          onSelect(newList.id);
        }}
        onCancel={() => setCreating(false)}
      />
    );
  }

  // Walk list index
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold" style={{ color: "#1a1915", fontFamily: "monospace", letterSpacing: 1 }}>WALK LISTS</h2>
        <button onClick={() => setCreating(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold"
          style={{ background: "#e8a838", color: "#1a1915" }}>
          <Plus size={13} /> New Walk List
        </button>
      </div>

      {walkLists.length === 0 ? (
        <div className="rounded-lg p-8 text-center" style={{ background: "white", border: "1px solid #e5e2db" }}>
          <MapPin size={32} className="mx-auto mb-3" style={{ color: "#d1d5db" }} />
          <p style={{ color: "#8a8477" }}>No walk lists yet. Create one to start canvassing.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {walkLists.map(wl => {
            const assignee = users.find(u => u.id === wl.volunteerId);
            const contacted = contactLogs.filter(c => wl.voterIds.includes(c.voterId)).length;
            const pct = wl.voterIds.length ? Math.round(contacted / wl.voterIds.length * 100) : 0;
            return (
              <div key={wl.id} onClick={() => onSelect(wl.id)}
                className="rounded-lg p-4 cursor-pointer transition-all hover:shadow-sm"
                style={{ background: "white", border: "1px solid #e5e2db" }}>
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-semibold" style={{ color: "#1a1915" }}>{wl.name}</h4>
                    <p className="text-xs mt-0.5" style={{ color: "#a09a8e" }}>
                      {wl.voterIds.length} voters · {assignee?.name || "Unassigned"} · {new Date(wl.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs px-2 py-0.5 rounded font-medium`}
                      style={{
                        background: wl.status === "completed" ? "#f0fdf4" : "#fffbeb",
                        color: wl.status === "completed" ? "#16a34a" : "#ca8a04"
                      }}>
                      {wl.status === "completed" ? "Complete" : "Active"}
                    </span>
                    <div className="text-right">
                      <p className="text-xs font-bold" style={{ color: "#4b4840" }}>{pct}%</p>
                      <div className="w-16 h-1.5 rounded-full" style={{ background: "#e5e2db" }}>
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "#16a34a" }} />
                      </div>
                    </div>
                    <ChevronRight size={16} style={{ color: "#a09a8e" }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── WALK LIST BUILDER ────────────────────────────────────
function WalkListBuilder({ voters, users, walkLists, onSave, onCancel }) {
  const [name, setName] = useState(`Walk List ${new Date().toLocaleDateString()}`);
  const [volunteerId, setVolunteerId] = useState("");
  const [filterStreet, setFilterStreet] = useState("");
  const [filterPrecinct, setFilterPrecinct] = useState("");
  const [filterParty, setFilterParty] = useState("");
  const [filterElections, setFilterElections] = useState({}); // { electionName: "voted" | "not_voted" }
  const [showElectionFilter, setShowElectionFilter] = useState(false);
  const [excludeContacted, setExcludeContacted] = useState(true);
  const [excludePrevListed, setExcludePrevListed] = useState(false);
  const [excludeDNC, setExcludeDNC] = useState(true);
  const [selectedIds, setSelectedIds] = useState(new Set());

  const prevListedIds = useMemo(() => {
    const ids = new Set();
    walkLists.forEach(wl => wl.voterIds.forEach(vid => ids.add(vid)));
    return ids;
  }, [walkLists]);

  const streets = useMemo(() => [...new Set(voters.map(v => normalizeStreet(v.address)).filter(Boolean))].sort(), [voters]);
  const precincts = useMemo(() => [...new Set(voters.map(v => v.precinct).filter(Boolean))].sort(), [voters]);
  const parties = useMemo(() => [...new Set(voters.map(v => v.party).filter(Boolean))].sort(), [voters]);
  const volunteers = users.filter(u => u.role === "volunteer");
  
  const allElections = useMemo(() => {
    const elecs = new Set();
    voters.forEach(v => {
      if (v.elections) Object.keys(v.elections).forEach(e => elecs.add(e));
    });
    return [...elecs].sort((a, b) => b.localeCompare(a));
  }, [voters]);

  const activeElectionFilters = Object.keys(filterElections).filter(k => filterElections[k]);

  const filtered = useMemo(() => {
    return voters.filter(v => {
      if (excludeDNC && v.doNotContact) return false;
      if (excludeContacted && v.supportScore) return false;
      if (excludePrevListed && prevListedIds.has(v.id)) return false;
      if (filterStreet && normalizeStreet(v.address) !== filterStreet) return false;
      if (filterPrecinct && v.precinct !== filterPrecinct) return false;
      if (filterParty && v.party !== filterParty) return false;
      // Election-specific filters
      for (const [elec, mode] of Object.entries(filterElections)) {
        if (!mode) continue;
        const val = v.elections?.[elec];
        const voted = didVote(val);
        if (mode === "voted" && !voted) return false;
        if (mode === "not_voted" && voted) return false;
      }
      return true;
    });
  }, [voters, filterStreet, filterPrecinct, filterParty, filterElections, excludeContacted, excludePrevListed, excludeDNC, prevListedIds]);

  const toggleAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(v => v.id)));
    }
  };

  const toggle = (id) => {
    const next = new Set(selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedIds(next);
  };

  const handleSave = () => {
    if (!name.trim() || selectedIds.size === 0) return;
    onSave({
      id: generateId("wl"),
      name: name.trim(),
      volunteerId,
      voterIds: [...selectedIds],
      status: "active",
      createdAt: new Date().toISOString(),
      filters: { filterStreet, filterPrecinct, filterParty, filterElections, excludeContacted, excludePrevListed, excludeDNC },
    });
  };

  // Group by address for display
  const byAddress = {};
  filtered.forEach(v => {
    const addr = v.address || "Unknown";
    if (!byAddress[addr]) byAddress[addr] = [];
    byAddress[addr].push(v);
  });
  const sortedAddresses = Object.keys(byAddress).sort((a, b) => {
    const sa = normalizeStreet(a), sb = normalizeStreet(b);
    if (sa !== sb) return sa.localeCompare(sb);
    return getStreetNumber(a) - getStreetNumber(b);
  });

  return (
    <div>
      <button onClick={onCancel} className="flex items-center gap-1 text-sm mb-4" style={{ color: "#8a8477" }}>
        <ArrowLeft size={14} /> Cancel
      </button>

      <div className="rounded-lg p-5 mb-4" style={{ background: "white", border: "1px solid #e5e2db" }}>
        <h3 className="text-sm font-bold mb-3" style={{ fontFamily: "monospace", color: "#1a1915" }}>CREATE WALK LIST</h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <div>
            <label className="block text-xs mb-1" style={{ color: "#8a8477", fontFamily: "monospace" }}>LIST NAME</label>
            <input value={name} onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 rounded text-sm outline-none" style={{ border: "1px solid #e5e2db" }} />
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: "#8a8477", fontFamily: "monospace" }}>ASSIGN TO</label>
            <select value={volunteerId} onChange={e => setVolunteerId(e.target.value)}
              className="w-full px-3 py-2 rounded text-sm" style={{ border: "1px solid #e5e2db" }}>
              <option value="">Unassigned</option>
              {volunteers.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <div>
            <label className="block text-xs mb-1" style={{ color: "#8a8477", fontFamily: "monospace" }}>STREET</label>
            <select value={filterStreet} onChange={e => setFilterStreet(e.target.value)}
              className="w-full px-2 py-1.5 rounded text-xs" style={{ border: "1px solid #e5e2db" }}>
              <option value="">All Streets</option>
              {streets.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: "#8a8477", fontFamily: "monospace" }}>PRECINCT</label>
            <select value={filterPrecinct} onChange={e => setFilterPrecinct(e.target.value)}
              className="w-full px-2 py-1.5 rounded text-xs" style={{ border: "1px solid #e5e2db" }}>
              <option value="">All Precincts</option>
              {precincts.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: "#8a8477", fontFamily: "monospace" }}>PARTY</label>
            <select value={filterParty} onChange={e => setFilterParty(e.target.value)}
              className="w-full px-2 py-1.5 rounded text-xs" style={{ border: "1px solid #e5e2db" }}>
              <option value="">All Parties</option>
              {parties.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>

        {/* Election filter checkboxes */}
        {allElections.length > 0 && (
          <div className="mb-3">
            <button onClick={() => setShowElectionFilter(!showElectionFilter)}
              className="flex items-center gap-1.5 text-xs font-semibold mb-2"
              style={{ color: activeElectionFilters.length > 0 ? "#1d4ed8" : "#8a8477", fontFamily: "monospace" }}>
              <Hash size={11} /> ELECTION HISTORY FILTER {activeElectionFilters.length > 0 && `(${activeElectionFilters.length} active)`}
              <ChevronDown size={12} style={{ transform: showElectionFilter ? "rotate(180deg)" : "none", transition: "0.2s" }} />
            </button>
            {showElectionFilter && (
              <div className="rounded p-3" style={{ background: "#f8faff", border: "1px solid #bfdbfe" }}>
                <p className="text-xs mb-2" style={{ color: "#6b7280" }}>
                  Click = must have voted · Shift+click = must NOT have voted · Multiple selections are AND logic
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
                  {allElections.map(elec => {
                    const mode = filterElections[elec];
                    return (
                      <div key={elec} className="flex items-center gap-2 py-1 px-2 rounded cursor-pointer"
                        style={{ background: mode === "voted" ? "#f0fdf4" : mode === "not_voted" ? "#fef2f2" : "transparent" }}
                        onClick={(e) => {
                          const next = { ...filterElections };
                          if (e.shiftKey) {
                            next[elec] = mode === "not_voted" ? undefined : "not_voted";
                          } else {
                            next[elec] = mode === "voted" ? undefined : "voted";
                          }
                          if (!next[elec]) delete next[elec];
                          setFilterElections(next);
                        }}>
                        <div className="w-4 h-4 rounded border flex items-center justify-center flex-shrink-0" style={{
                          borderColor: mode === "voted" ? "#16a34a" : mode === "not_voted" ? "#dc2626" : "#d1d5db",
                          background: mode === "voted" ? "#16a34a" : mode === "not_voted" ? "#dc2626" : "white",
                        }}>
                          {mode === "voted" && <Check size={10} color="white" />}
                          {mode === "not_voted" && <X size={10} color="white" />}
                        </div>
                        <span className="text-xs flex-1" style={{ color: mode ? "#1a1915" : "#6b7280" }}>
                          {elec.replace(/_/g, " ")}
                        </span>
                        {mode === "not_voted" && (
                          <span className="text-xs" style={{ color: "#dc2626" }}>didn't vote</span>
                        )}
                      </div>
                    );
                  })}
                </div>
                {activeElectionFilters.length > 0 && (
                  <button onClick={() => setFilterElections({})} className="text-xs mt-2" style={{ color: "#dc2626" }}>Clear election filters</button>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-4 mb-3 flex-wrap">
          <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: "#4b4840" }}>
            <input type="checkbox" checked={excludeContacted} onChange={e => setExcludeContacted(e.target.checked)} />
            Exclude already scored
          </label>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: "#4b4840" }}>
            <input type="checkbox" checked={excludePrevListed} onChange={e => setExcludePrevListed(e.target.checked)} />
            Exclude previously listed
          </label>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: "#4b4840" }}>
            <input type="checkbox" checked={excludeDNC} onChange={e => setExcludeDNC(e.target.checked)} />
            Exclude DNC
          </label>
        </div>

        <div className="flex items-center justify-between">
          <p className="text-xs" style={{ color: "#8a8477" }}>
            {filtered.length} voters match · {selectedIds.size} selected · {sortedAddresses.length} addresses
          </p>
          <div className="flex gap-2">
            <button onClick={toggleAll} className="px-3 py-1 rounded text-xs"
              style={{ border: "1px solid #e5e2db", color: "#4b4840" }}>
              {selectedIds.size === filtered.length ? "Deselect All" : "Select All"}
            </button>
            <button onClick={handleSave} disabled={selectedIds.size === 0}
              className="px-4 py-1.5 rounded text-xs font-semibold"
              style={{ background: selectedIds.size ? "#e8a838" : "#e5e2db", color: selectedIds.size ? "#1a1915" : "#a09a8e" }}>
              Create List ({selectedIds.size})
            </button>
          </div>
        </div>
      </div>

      {/* Address-grouped voter list */}
      <div className="rounded-lg overflow-hidden" style={{ border: "1px solid #e5e2db", background: "white", maxHeight: 400, overflowY: "auto" }}>
        {sortedAddresses.map(addr => (
          <div key={addr} style={{ borderBottom: "2px solid #e5e2db" }}>
            <div className="px-3 py-1.5 flex items-center gap-2" style={{ background: "#faf9f6" }}>
              <Home size={12} style={{ color: "#e8a838" }} />
              <span className="text-xs font-semibold" style={{ color: "#1a1915" }}>{addr}</span>
              {prevListedIds.has(byAddress[addr][0]?.id) && (
                <span className="text-xs px-1 rounded" style={{ background: "#eff6ff", color: "#3b82f6" }}>prev listed</span>
              )}
            </div>
            {byAddress[addr].map(v => (
              <label key={v.id} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-gray-50"
                style={{ borderTop: "1px solid #f0ede6" }}>
                <input type="checkbox" checked={selectedIds.has(v.id)} onChange={() => toggle(v.id)} />
                <span className="text-sm" style={{ color: "#1a1915" }}>{v.firstName} {v.lastName}</span>
                <span className="text-xs" style={{ color: "#a09a8e" }}>{v.party}</span>
              </label>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── REPORTS VIEW ─────────────────────────────────────────
function ReportsView({ voters, walkLists, contactLogs, users }) {
  const contacted = voters.filter(v => contactLogs.some(c => c.voterId === v.id));
  const notContacted = voters.length - contacted.length;

  // By precinct
  const byPrecinct = {};
  voters.forEach(v => {
    const p = v.precinct || "Unknown";
    if (!byPrecinct[p]) byPrecinct[p] = { total: 0, contacted: 0, scores: {} };
    byPrecinct[p].total++;
    if (contactLogs.some(c => c.voterId === v.id)) byPrecinct[p].contacted++;
    if (v.supportScore) byPrecinct[p].scores[v.supportScore] = (byPrecinct[p].scores[v.supportScore] || 0) + 1;
  });

  // By street coverage - group by normalized street name
  const byStreet = {};
  voters.forEach(v => {
    const s = normalizeStreet(v.address) || "unknown";
    if (!byStreet[s]) byStreet[s] = { total: 0, contacted: 0, listed: 0, displayName: "" };
    byStreet[s].total++;
    // Keep the most common full street from addresses for display
    if (!byStreet[s].displayName) {
      byStreet[s].displayName = (v.address || "").replace(/^\d+[-\s]?\d*\s*/, "").replace(/\s*[,#]\s*\d+.*$/i, "").replace(/\s+(apt|unit|suite|ste|spc|space|lot)\s*[#.]?\s*\w*$/i, "").trim();
    }
    if (contactLogs.some(c => c.voterId === v.id)) byStreet[s].contacted++;
  });
  walkLists.forEach(wl => {
    wl.voterIds.forEach(vid => {
      const v = voters.find(voter => voter.id === vid);
      if (v) {
        const s = normalizeStreet(v.address) || "Unknown";
        if (byStreet[s]) byStreet[s].listed++;
      }
    });
  });

  // Volunteer stats
  const volStats = {};
  users.filter(u => u.role === "volunteer").forEach(u => {
    volStats[u.id] = { name: u.name, knocks: 0, lists: 0 };
  });
  contactLogs.forEach(log => {
    const user = users.find(u => u.name === log.contactedBy);
    if (user && volStats[user.id]) volStats[user.id].knocks++;
  });
  walkLists.forEach(wl => {
    if (volStats[wl.volunteerId]) volStats[wl.volunteerId].lists++;
  });

  return (
    <div>
      <h2 className="text-lg font-bold mb-4" style={{ color: "#1a1915", fontFamily: "monospace", letterSpacing: 1 }}>REPORTS</h2>

      {/* Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Contacted", value: contacted.length, color: "#16a34a" },
          { label: "Not Contacted", value: notContacted, color: "#dc2626" },
          { label: "Yard Signs", value: voters.filter(v => v.yardSign).length, color: "#16a34a" },
          { label: "DNC", value: voters.filter(v => v.doNotContact).length, color: "#dc2626" },
        ].map(s => (
          <div key={s.label} className="rounded-lg p-3" style={{ background: "white", border: "1px solid #e5e2db" }}>
            <span className="text-xs" style={{ color: "#8a8477", fontFamily: "monospace" }}>{s.label.toUpperCase()}</span>
            <p className="text-xl font-bold mt-1" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Precinct breakdown */}
      <div className="rounded-lg p-4 mb-4" style={{ background: "white", border: "1px solid #e5e2db" }}>
        <h3 className="text-xs font-bold mb-3" style={{ color: "#8a8477", fontFamily: "monospace", letterSpacing: 1 }}>
          BY PRECINCT
        </h3>
        <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Precinct", "Total", "Contacted", "% Done", "1", "2", "3", "4", "5"].map(h => (
                <th key={h} className="px-2 py-1.5 text-left text-xs" style={{ color: "#8a8477", fontFamily: "monospace", borderBottom: "1px solid #e5e2db" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(byPrecinct).sort(([a],[b]) => a.localeCompare(b)).map(([pct, data]) => (
              <tr key={pct} style={{ borderBottom: "1px solid #f0ede6" }}>
                <td className="px-2 py-1.5 font-medium" style={{ color: "#1a1915" }}>{pct}</td>
                <td className="px-2 py-1.5" style={{ color: "#4b4840" }}>{data.total}</td>
                <td className="px-2 py-1.5" style={{ color: "#4b4840" }}>{data.contacted}</td>
                <td className="px-2 py-1.5 font-medium" style={{ color: "#16a34a" }}>
                  {data.total ? Math.round(data.contacted / data.total * 100) : 0}%
                </td>
                {[1,2,3,4,5].map(s => (
                  <td key={s} className="px-2 py-1.5" style={{ color: SUPPORT_COLORS[s] }}>{data.scores[s] || 0}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Street coverage */}
      <div className="rounded-lg p-4 mb-4" style={{ background: "white", border: "1px solid #e5e2db" }}>
        <h3 className="text-xs font-bold mb-3" style={{ color: "#8a8477", fontFamily: "monospace", letterSpacing: 1 }}>
          STREET COVERAGE
        </h3>
        <div className="overflow-y-auto" style={{ maxHeight: 300 }}>
          <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Street", "Voters", "Listed", "Contacted", "% Done"].map(h => (
                  <th key={h} className="px-2 py-1.5 text-left text-xs" style={{ color: "#8a8477", fontFamily: "monospace", borderBottom: "1px solid #e5e2db" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(byStreet).sort(([a],[b]) => a.localeCompare(b)).map(([st, data]) => (
                <tr key={st} style={{ borderBottom: "1px solid #f0ede6" }}>
                  <td className="px-2 py-1.5 font-medium" style={{ color: "#1a1915" }}>{data.displayName || st}</td>
                  <td className="px-2 py-1.5" style={{ color: "#4b4840" }}>{data.total}</td>
                  <td className="px-2 py-1.5" style={{ color: "#3b82f6" }}>{data.listed}</td>
                  <td className="px-2 py-1.5" style={{ color: "#16a34a" }}>{data.contacted}</td>
                  <td className="px-2 py-1.5 font-medium" style={{ color: data.total ? "#16a34a" : "#a09a8e" }}>
                    {data.total ? Math.round(data.contacted / data.total * 100) : 0}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Volunteer stats */}
      {Object.keys(volStats).length > 0 && (
        <div className="rounded-lg p-4" style={{ background: "white", border: "1px solid #e5e2db" }}>
          <h3 className="text-xs font-bold mb-3" style={{ color: "#8a8477", fontFamily: "monospace", letterSpacing: 1 }}>
            VOLUNTEER ACTIVITY
          </h3>
          <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Volunteer", "Walk Lists", "Doors Knocked"].map(h => (
                  <th key={h} className="px-2 py-1.5 text-left text-xs" style={{ color: "#8a8477", fontFamily: "monospace", borderBottom: "1px solid #e5e2db" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.values(volStats).map(vs => (
                <tr key={vs.name} style={{ borderBottom: "1px solid #f0ede6" }}>
                  <td className="px-2 py-1.5 font-medium" style={{ color: "#1a1915" }}>{vs.name}</td>
                  <td className="px-2 py-1.5" style={{ color: "#4b4840" }}>{vs.lists}</td>
                  <td className="px-2 py-1.5" style={{ color: "#4b4840" }}>{vs.knocks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── TEAM VIEW ────────────────────────────────────────────
function TeamView({ users, onUpdateUsers, walkLists, contactLogs }) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPin, setNewPin] = useState("");
  const [newRole, setNewRole] = useState("volunteer");

  const addUser = () => {
    if (!newName.trim() || !newUsername.trim() || !newPin.trim()) return;
    const user = {
      id: generateId("user"),
      name: newName.trim(),
      username: newUsername.trim().toLowerCase(),
      pin: newPin.trim(),
      role: newRole,
    };
    onUpdateUsers([...users, user]);
    setAdding(false);
    setNewName(""); setNewUsername(""); setNewPin(""); setNewRole("volunteer");
  };

  const removeUser = (id) => {
    if (id === "admin-1") return; // Protect default admin
    onUpdateUsers(users.filter(u => u.id !== id));
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold" style={{ color: "#1a1915", fontFamily: "monospace", letterSpacing: 1 }}>TEAM</h2>
        <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold"
          style={{ background: "#e8a838", color: "#1a1915" }}>
          <Plus size={13} /> Add User
        </button>
      </div>

      {/* Mobile workflow explanation */}
      <div className="rounded-lg p-4 mb-4" style={{ background: "#fffbeb", border: "1px solid #fde68a" }}>
        <p className="text-xs font-bold mb-1" style={{ color: "#92400e", fontFamily: "monospace" }}>HOW MOBILE CANVASSING WORKS</p>
        <p className="text-xs" style={{ color: "#92400e", lineHeight: 1.6 }}>
          1. Create volunteer accounts below with a username and PIN.
          2. Create walk lists (Walk Lists tab) and assign them to volunteers.
          3. Volunteers open this app on their phone and log in with their username/PIN.
          4. They see a mobile-optimized view with their assigned walk list, tap each door, and enter results.
          5. Admins can also use the "Canvass Mode" tab in the sidebar to enter results directly.
        </p>
      </div>

      {adding && (
        <div className="rounded-lg p-4 mb-4" style={{ background: "white", border: "2px solid #e8a838" }}>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
            <div>
              <label className="block text-xs mb-1" style={{ color: "#8a8477", fontFamily: "monospace" }}>NAME</label>
              <input value={newName} onChange={e => setNewName(e.target.value)}
                className="w-full px-3 py-2 rounded text-sm outline-none" style={{ border: "1px solid #e5e2db" }}
                placeholder="Jane Smith" />
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: "#8a8477", fontFamily: "monospace" }}>USERNAME</label>
              <input value={newUsername} onChange={e => setNewUsername(e.target.value)}
                className="w-full px-3 py-2 rounded text-sm outline-none" style={{ border: "1px solid #e5e2db" }}
                placeholder="jsmith" />
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: "#8a8477", fontFamily: "monospace" }}>PIN</label>
              <input value={newPin} onChange={e => setNewPin(e.target.value)}
                className="w-full px-3 py-2 rounded text-sm outline-none" style={{ border: "1px solid #e5e2db" }}
                placeholder="4-digit PIN" />
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: "#8a8477", fontFamily: "monospace" }}>ROLE</label>
              <select value={newRole} onChange={e => setNewRole(e.target.value)}
                className="w-full px-3 py-2 rounded text-sm" style={{ border: "1px solid #e5e2db" }}>
                <option value="volunteer">Volunteer</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={addUser} className="px-4 py-1.5 rounded text-xs font-semibold" style={{ background: "#16a34a", color: "white" }}>
              Add
            </button>
            <button onClick={() => setAdding(false)} className="px-4 py-1.5 rounded text-xs" style={{ border: "1px solid #e5e2db", color: "#8a8477" }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {users.map(u => {
          const lists = walkLists.filter(wl => wl.volunteerId === u.id).length;
          return (
            <div key={u.id} className="rounded-lg p-4 flex items-center justify-between"
              style={{ background: "white", border: "1px solid #e5e2db" }}>
              <div>
                <h4 className="text-sm font-semibold" style={{ color: "#1a1915" }}>{u.name}</h4>
                <p className="text-xs mt-0.5" style={{ color: "#a09a8e" }}>
                  @{u.username} · {u.role} · PIN: {u.pin} · {lists} list{lists !== 1 ? "s" : ""}
                </p>
              </div>
              {u.id !== "admin-1" && (
                <button onClick={() => removeUser(u.id)} className="p-1.5 rounded" style={{ color: "#dc2626" }}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── MOBILE CANVASSER VIEW ────────────────────────────────
function MobileCanvasserView({ session, voters, walkLists, contactLogs, onUpdateVoter, onAddContactLog, onLogout }) {
  const [selectedList, setSelectedList] = useState(null);
  const [activeAddress, setActiveAddress] = useState(null);
  const [activeVoter, setActiveVoter] = useState(null);

  // Door entry form
  const [score, setScore] = useState(null);
  const [yardSign, setYardSign] = useState(false);
  const [dnc, setDnc] = useState(false);
  const [outcome, setOutcome] = useState(""); // spoke, not_home, refused
  const [notes, setNotes] = useState("");

  const contactedIds = useMemo(() => new Set(contactLogs.map(c => c.voterId)), [contactLogs]);

  // If viewing a specific voter door
  if (activeVoter && selectedList) {
    const v = activeVoter;
    const handleSave = async () => {
      const updatedVoter = {
        ...v,
        supportScore: score,
        yardSign,
        doNotContact: dnc,
        notes: notes ? (v.notes ? v.notes + "\n" + notes : notes) : v.notes,
      };
      await onUpdateVoter(updatedVoter);
      await onAddContactLog({
        id: generateId("log"),
        voterId: v.id,
        contactedBy: session.name,
        timestamp: new Date().toISOString(),
        supportScore: score,
        outcome,
        yardSign,
        doNotContact: dnc,
        notes,
      });
      setActiveVoter(null);
      setScore(null); setYardSign(false); setDnc(false); setOutcome(""); setNotes("");
    };

    return (
      <div className="min-h-screen" style={{ background: "#1a1915" }}>
        <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: "1px solid #2d2a23" }}>
          <button onClick={() => setActiveVoter(null)} style={{ color: "#e8a838" }}><ArrowLeft size={20} /></button>
          <div>
            <h2 className="text-sm font-bold" style={{ color: "#f5f0e8" }}>{v.firstName} {v.lastName}</h2>
            <p className="text-xs" style={{ color: "#8a8477" }}>{v.address}</p>
          </div>
        </div>

        <div className="p-4 space-y-5">
          {/* Voter info */}
          <div className="rounded-lg p-3" style={{ background: "#2d2a23" }}>
            <div className="flex justify-between text-xs" style={{ color: "#a09a8e" }}>
              <span>Party: {v.party || "N/A"}</span>
              <span>Precinct: {v.precinct || "N/A"}</span>
            </div>
            {v.phone && <p className="text-xs mt-1" style={{ color: "#a09a8e" }}>Phone: {v.phone}</p>}
          </div>

          {/* Outcome */}
          <div>
            <p className="text-xs font-bold mb-2" style={{ color: "#8a8477", fontFamily: "monospace" }}>OUTCOME</p>
            <div className="flex gap-2">
              {[["spoke", "Spoke"], ["not_home", "Not Home"], ["refused", "Refused"]].map(([val, label]) => (
                <button key={val} onClick={() => setOutcome(val)}
                  className="flex-1 py-3 rounded-lg text-sm font-semibold transition-all"
                  style={{
                    background: outcome === val ? "#e8a838" : "#2d2a23",
                    color: outcome === val ? "#1a1915" : "#a09a8e",
                    border: outcome === val ? "2px solid #e8a838" : "2px solid #3d3a33",
                  }}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Support Score */}
          {outcome === "spoke" && (
            <div>
              <p className="text-xs font-bold mb-2" style={{ color: "#8a8477", fontFamily: "monospace" }}>SUPPORT (1=Strong For, 5=Strong Against)</p>
              <div className="flex gap-2">
                {[1,2,3,4,5].map(s => (
                  <button key={s} onClick={() => setScore(score === s ? null : s)}
                    className="flex-1 py-4 rounded-lg text-lg font-bold transition-all"
                    style={{
                      background: score === s ? SUPPORT_COLORS[s] : "#2d2a23",
                      color: score === s ? "white" : SUPPORT_COLORS[s],
                      border: `2px solid ${SUPPORT_COLORS[s]}`,
                    }}>
                    {s}
                  </button>
                ))}
              </div>
              <div className="flex justify-between mt-1 px-1">
                <span className="text-xs" style={{ color: "#16a34a" }}>Support</span>
                <span className="text-xs" style={{ color: "#dc2626" }}>Oppose</span>
              </div>
            </div>
          )}

          {/* Toggles */}
          <div className="flex gap-3">
            <button onClick={() => setYardSign(!yardSign)}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-semibold"
              style={{
                background: yardSign ? "#16a34a" : "#2d2a23",
                color: yardSign ? "white" : "#a09a8e",
                border: yardSign ? "2px solid #16a34a" : "2px solid #3d3a33",
              }}>
              <Flag size={16} /> Yard Sign
            </button>
            <button onClick={() => setDnc(!dnc)}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-semibold"
              style={{
                background: dnc ? "#dc2626" : "#2d2a23",
                color: dnc ? "white" : "#a09a8e",
                border: dnc ? "2px solid #dc2626" : "2px solid #3d3a33",
              }}>
              <AlertTriangle size={16} /> DNC
            </button>
          </div>

          {/* Notes */}
          <div>
            <p className="text-xs font-bold mb-2" style={{ color: "#8a8477", fontFamily: "monospace" }}>NOTES</p>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="w-full px-3 py-2 rounded-lg text-sm outline-none"
              style={{ background: "#2d2a23", color: "#f5f0e8", border: "1px solid #3d3a33" }}
              placeholder="Any additional notes..." />
          </div>

          {/* Save */}
          <button onClick={handleSave} disabled={!outcome}
            className="w-full py-4 rounded-lg text-base font-bold transition-all"
            style={{
              background: outcome ? "#e8a838" : "#3d3a33",
              color: outcome ? "#1a1915" : "#6b6560",
            }}>
            Save & Next Door
          </button>
        </div>
      </div>
    );
  }

  // If viewing a walk list (address list)
  if (selectedList) {
    const wl = selectedList;
    const wlVoters = wl.voterIds.map(vid => voters.find(v => v.id === vid)).filter(Boolean);
    const byAddress = {};
    wlVoters.forEach(v => {
      const addr = v.address || "Unknown";
      if (!byAddress[addr]) byAddress[addr] = [];
      byAddress[addr].push(v);
    });
    const sortedAddresses = Object.keys(byAddress).sort((a, b) => {
      const sa = normalizeStreet(a), sb = normalizeStreet(b);
      if (sa !== sb) return sa.localeCompare(sb);
      return getStreetNumber(a) - getStreetNumber(b);
    });

    const totalDone = wlVoters.filter(v => contactedIds.has(v.id)).length;
    const pct = wlVoters.length ? Math.round(totalDone / wlVoters.length * 100) : 0;

    return (
      <div className="min-h-screen" style={{ background: "#1a1915" }}>
        <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: "1px solid #2d2a23" }}>
          <button onClick={() => setSelectedList(null)} style={{ color: "#e8a838" }}><ArrowLeft size={20} /></button>
          <div className="flex-1">
            <h2 className="text-sm font-bold" style={{ color: "#f5f0e8" }}>{wl.name}</h2>
            <p className="text-xs" style={{ color: "#8a8477" }}>{totalDone}/{wlVoters.length} done</p>
          </div>
          <div className="text-right">
            <span className="text-lg font-bold" style={{ color: "#e8a838" }}>{pct}%</span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-1" style={{ background: "#2d2a23" }}>
          <div className="h-full transition-all" style={{ width: `${pct}%`, background: "#16a34a" }} />
        </div>

        <div className="p-3 space-y-2">
          {sortedAddresses.map(addr => {
            const addrVoters = byAddress[addr];
            const allDone = addrVoters.every(v => contactedIds.has(v.id));
            const someDone = addrVoters.some(v => contactedIds.has(v.id));

            return (
              <div key={addr} className="rounded-lg overflow-hidden" style={{ background: "#2d2a23", border: "1px solid #3d3a33" }}>
                <div className="px-3 py-2.5 flex items-center gap-2"
                  onClick={() => setActiveAddress(activeAddress === addr ? null : addr)}
                  style={{ cursor: "pointer" }}>
                  {allDone ? (
                    <CheckCircle size={18} style={{ color: "#16a34a" }} />
                  ) : someDone ? (
                    <Clock size={18} style={{ color: "#e8a838" }} />
                  ) : (
                    <Circle size={18} style={{ color: "#6b6560" }} />
                  )}
                  <span className="text-sm font-semibold flex-1" style={{ color: allDone ? "#8a8477" : "#f5f0e8" }}>
                    {addr}
                  </span>
                  <span className="text-xs" style={{ color: "#8a8477" }}>{addrVoters.length}</span>
                  <ChevronDown size={16} style={{ color: "#6b6560", transform: activeAddress === addr ? "rotate(180deg)" : "none", transition: "0.2s" }} />
                </div>

                {activeAddress === addr && (
                  <div style={{ borderTop: "1px solid #3d3a33" }}>
                    {addrVoters.map(v => {
                      const done = contactedIds.has(v.id);
                      return (
                        <button key={v.id} onClick={() => {
                          setActiveVoter(v);
                          setScore(v.supportScore);
                          setYardSign(v.yardSign || false);
                          setDnc(v.doNotContact || false);
                          setOutcome(""); setNotes("");
                        }}
                          className="w-full flex items-center gap-3 px-4 py-3 text-left"
                          style={{ borderTop: "1px solid #3d3a33" }}>
                          <div className="flex-1">
                            <span className="text-sm" style={{ color: done ? "#8a8477" : "#f5f0e8" }}>
                              {v.firstName} {v.lastName}
                            </span>
                            <span className="text-xs ml-2" style={{ color: "#6b6560" }}>{v.party}</span>
                          </div>
                          {v.supportScore && (
                            <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                              style={{ background: SUPPORT_COLORS[v.supportScore] }}>{v.supportScore}</div>
                          )}
                          {done ? (
                            <CheckCircle size={16} style={{ color: "#16a34a" }} />
                          ) : (
                            <ChevronRight size={16} style={{ color: "#6b6560" }} />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Walk list selector
  return (
    <div className="min-h-screen" style={{ background: "#1a1915" }}>
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid #2d2a23" }}>
        <div>
          <h1 className="text-sm font-bold tracking-widest" style={{ color: "#e8a838", fontFamily: "monospace" }}>EC CANVASS</h1>
          <p className="text-xs" style={{ color: "#8a8477" }}>Hey, {session.name}</p>
        </div>
        <button onClick={onLogout} className="p-2 rounded" style={{ color: "#8a8477" }}>
          <LogOut size={18} />
        </button>
      </div>

      <div className="p-4">
        <h2 className="text-xs font-bold mb-3" style={{ color: "#8a8477", fontFamily: "monospace", letterSpacing: 1 }}>
          YOUR WALK LISTS
        </h2>

        {walkLists.length === 0 ? (
          <div className="rounded-lg p-8 text-center" style={{ background: "#2d2a23" }}>
            <MapPin size={32} className="mx-auto mb-3" style={{ color: "#6b6560" }} />
            <p className="text-sm" style={{ color: "#8a8477" }}>No walk lists assigned yet. Check back with your campaign manager.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {walkLists.filter(wl => wl.status !== "completed").map(wl => {
              const wlVoters = wl.voterIds.map(vid => voters.find(v => v.id === vid)).filter(Boolean);
              const done = wlVoters.filter(v => contactedIds.has(v.id)).length;
              const pct = wlVoters.length ? Math.round(done / wlVoters.length * 100) : 0;
              return (
                <button key={wl.id} onClick={() => setSelectedList(wl)}
                  className="w-full rounded-lg p-4 text-left"
                  style={{ background: "#2d2a23", border: "1px solid #3d3a33" }}>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold" style={{ color: "#f5f0e8" }}>{wl.name}</h3>
                    <span className="text-lg font-bold" style={{ color: "#e8a838" }}>{pct}%</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs" style={{ color: "#8a8477" }}>{wlVoters.length} doors</span>
                    <span className="text-xs" style={{ color: "#16a34a" }}>{done} done</span>
                    <div className="flex-1 h-1.5 rounded-full" style={{ background: "#3d3a33" }}>
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: "#16a34a" }} />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {walkLists.some(wl => wl.status === "completed") && (
          <>
            <h2 className="text-xs font-bold mt-6 mb-3" style={{ color: "#8a8477", fontFamily: "monospace" }}>COMPLETED</h2>
            {walkLists.filter(wl => wl.status === "completed").map(wl => (
              <div key={wl.id} className="rounded-lg p-3 mb-2" style={{ background: "#2d2a23", opacity: 0.6 }}>
                <span className="text-sm" style={{ color: "#8a8477" }}>{wl.name}</span>
                <CheckCircle size={14} className="inline ml-2" style={{ color: "#16a34a" }} />
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
