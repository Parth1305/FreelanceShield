"use client";

import { useMemo, useState } from "react";

type Milestone = { id: number; title: string; due: string; amount: number; status: "Released" | "In review" | "Upcoming" };
const initialMilestones: Milestone[] = [
  { id: 1, title: "Discovery & wireframes", due: "Completed Aug 12", amount: 1200, status: "Released" },
  { id: 2, title: "Core product build", due: "Submitted Aug 23", amount: 2800, status: "In review" },
  { id: 3, title: "QA & launch", due: "Due Sep 06", amount: 1000, status: "Upcoming" },
];
const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);

export default function Home() {
  const [milestones, setMilestones] = useState(initialMilestones);
  const [notice, setNotice] = useState("Milestone 2 is ready for your review");
  const [panel, setPanel] = useState<"none" | "new" | "dispute">("none");
  const [wallet, setWallet] = useState(false);
  const [activity, setActivity] = useState([
    ["2h", "Maya submitted milestone 2", "Files and delivery notes are ready"],
    ["1d", "Escrow funded", "3,800 USDC locked on Ethereum"],
    ["12d", "Milestone 1 released", "1,200 USDC sent to Maya"],
  ]);
  const released = useMemo(() => milestones.filter((m) => m.status === "Released").reduce((s, m) => s + m.amount, 0), [milestones]);
  const locked = milestones.reduce((s, m) => s + (m.status === "Released" ? 0 : m.amount), 0);

  function approve(id: number) {
    const target = milestones.find((m) => m.id === id);
    if (!target) return;
    setMilestones((list) => list.map((m) => m.id === id ? { ...m, status: "Released" } : m));
    setActivity((items) => [["Now", `${target.title} approved`, `${money(target.amount)} queued for release`], ...items]);
    setNotice(`${money(target.amount)} released safely to Maya Chen`);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#top" aria-label="FreelanceShield home"><span className="brand-mark">FS</span><span>Freelance<span>Shield</span></span></a>
        <nav aria-label="Main navigation">
          <a className="active" href="#overview"><span>⌂</span> Overview</a>
          <a href="#projects"><span>▱</span> Contracts <b>2</b></a>
          <a href="#activity"><span>↗</span> Activity</a>
          <a href="#reputation"><span>◇</span> Reputation</a>
        </nav>
        <div className="side-bottom">
          <div className="shield-note"><span>✓</span><div><strong>Smart contracts active</strong><small>Protected on Ethereum</small></div></div>
          <a href="#settings"><span>⚙</span> Settings</a>
          <div className="profile"><div className="avatar">PG</div><div><strong>Parth Gohil</strong><small>Client account</small></div><button aria-label="Open profile menu">•••</button></div>
        </div>
      </aside>

      <section className="content" id="top">
        <header><div className="mobile-brand"><span className="brand-mark">FS</span> FreelanceShield</div><div className="header-actions"><button className="icon-button" aria-label="Notifications">◔<i /></button><button className={wallet ? "wallet connected" : "wallet"} onClick={() => setWallet(!wallet)}><span />{wallet ? "0x71F…9A2C" : "Connect wallet"}</button></div></header>
        <div className="page" id="overview">
          <div className="welcome"><div><p className="eyebrow">MONDAY, AUGUST 24</p><h1>Good evening, Parth.</h1><p>Here’s what’s happening across your contracts.</p></div><button className="primary" onClick={() => setPanel("new")}><span>+</span> New contract</button></div>
          <div className="notice"><div className="notice-icon">✓</div><div><strong>{notice}</strong><p>Review the delivery and release payment when you’re satisfied.</p></div><a href="#milestones">Review now →</a></div>
          <section className="metrics" aria-label="Contract summary">
            <article><p>ACTIVE CONTRACTS <span>▱</span></p><strong>2</strong><small>1 awaiting your review</small></article>
            <article><p>PROTECTED IN ESCROW <span>⬡</span></p><strong>{money(locked)}</strong><small>Funds secured on-chain</small></article>
            <article><p>TOTAL RELEASED <span>↗</span></p><strong>{money(released)}</strong><small>Across completed milestones</small></article>
            <article><p>REPUTATION SCORE <span>◇</span></p><strong>94 <em>/ 100</em></strong><small><i className="dot" /> Excellent standing</small></article>
          </section>

          <section className="contract-card" id="projects">
            <div className="contract-head"><div><span className="live">ACTIVE</span><span className="chain">⬡ Ethereum</span><h2>DeFi Analytics Dashboard</h2><p>with <b>Maya Chen</b> · Contract #FS-2841</p></div><button className="more" aria-label="More contract options">•••</button></div>
            <div className="progress-wrap"><div className="progress-copy"><span>Contract progress</span><b>{Math.round((released / 5000) * 100)}%</b></div><div className="progress"><span style={{ width: `${(released / 5000) * 100}%` }} /></div><div className="progress-label"><span>{money(released)} released</span><span>{money(5000 - released)} remaining</span></div></div>
            <div className="milestones" id="milestones">
              {milestones.map((m) => <div className="milestone" key={m.id}><div className={`step ${m.status === "Released" ? "done" : m.status === "In review" ? "current" : ""}`}>{m.status === "Released" ? "✓" : m.id}</div><div className="milestone-copy"><strong>{m.title}</strong><small>{m.due}</small></div><span className={`status ${m.status.toLowerCase().replace(" ", "-")}`}>{m.status === "Released" ? "✓ " : m.status === "In review" ? "◷ " : ""}{m.status}</span><b className="amount">{money(m.amount)}</b>{m.status === "In review" && <button className="approve" onClick={() => approve(m.id)}>Approve & release</button>}</div>)}
            </div>
            <div className="contract-footer"><div><span>◷</span><p><strong>Auto-release in 2 days</strong><small>Payment releases automatically unless you open a dispute.</small></p></div><button className="text-button" onClick={() => setPanel("dispute")}>Open dispute</button></div>
          </section>

          <section className="bottom-grid">
            <article className="panel" id="activity"><div className="panel-title"><h3>Recent activity</h3><button>View all</button></div>{activity.slice(0,3).map((item, index) => <div className="activity" key={index}><span className="activity-icon">{index === 0 ? "↗" : index === 1 ? "⬡" : "✓"}</span><div><strong>{item[1]}</strong><small>{item[2]}</small></div><time>{item[0]}</time></div>)}</article>
            <article className="panel reputation" id="reputation"><div className="panel-title"><h3>Your reputation</h3><button>View profile</button></div><div className="score"><div><strong>94</strong><span>/100</span></div><p>Excellent<small>Top 8% of clients</small></p></div><div className="score-bar"><span /></div><div className="reputation-stats"><div><b>12</b><small>Contracts</small></div><div><b>100%</b><small>On-time pay</small></div><div><b>4.9</b><small>Avg. rating</small></div></div></article>
          </section>
        </div>
      </section>

      {panel !== "none" && <div className="overlay" role="presentation" onMouseDown={() => setPanel("none")}><section className="drawer" role="dialog" aria-modal="true" aria-label={panel === "new" ? "Create new contract" : "Open dispute"} onMouseDown={(e) => e.stopPropagation()}><button className="close" onClick={() => setPanel("none")}>×</button>{panel === "new" ? <><p className="eyebrow">SMART ESCROW</p><h2>Create a protected contract</h2><p className="drawer-lead">Define the work and milestones. Funds stay locked until delivery is approved.</p><label>Freelancer wallet<input placeholder="0x…" /></label><label>Project name<input placeholder="e.g. Mobile app redesign" /></label><div className="field-row"><label>Budget<input type="number" placeholder="5,000" /></label><label>Currency<select defaultValue="USDC"><option>USDC</option><option>ETH</option></select></label></div><button className="primary wide" onClick={() => { setPanel("none"); setNotice("Draft contract created—add milestones to continue"); }}>Create draft contract</button><small className="fine">No gas fee until both parties sign.</small></> : <><p className="eyebrow danger-text">RESOLUTION CENTER</p><h2>Pause auto-release</h2><p className="drawer-lead">Opening a dispute locks the milestone funds while evidence is reviewed.</p><label>What needs attention?<select defaultValue="work"><option value="work">Work does not match the brief</option><option>Delivery is incomplete</option><option>Unable to contact freelancer</option></select></label><label>Describe the issue<textarea rows={5} placeholder="Add clear details and links to supporting evidence…" /></label><button className="danger wide" onClick={() => { setPanel("none"); setNotice("Dispute draft saved—funds remain protected"); }}>Continue to evidence</button><small className="fine">Nothing is sent until you confirm on the next step.</small></>}</section></div>}
    </main>
  );
}
