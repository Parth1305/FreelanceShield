"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { getAddress, isAddress, parseEther } from "viem";
import type { Address, Hex } from "viem";
import {
  apiRequest,
  errorMessage,
  type AccountRole,
  type MilestoneRecord,
  type PreparedTransaction,
  type ProjectDetails,
  type ProjectSummary,
  type SafeUser,
} from "./lib/frontend-api";
import {
  connectMetaMask,
  formatEth,
  fundEscrow,
  readReputation,
  sendPreparedTransaction,
  shortAddress,
  type ReputationView,
} from "./lib/wallet";

const TOKEN_KEY = "freelance-shield.access-token";
const emptyReputation: ReputationView = {
  available: false,
  score: null,
  completedContracts: 0,
  disputesOpened: 0,
  disputesWon: 0,
  disputesLost: 0,
};

type WorkspaceRole = "client" | "freelancer";
type Drawer =
  | { kind: "create" }
  | { kind: "submit"; milestone: MilestoneRecord }
  | { kind: "dispute"; milestone: MilestoneRecord }
  | null;

type DraftMilestone = { title: string; description: string; amountEth: string };

function projectStatus(status: ProjectSummary["status"]) {
  return status.replaceAll("_", " ");
}

function milestoneStatus(status: MilestoneRecord["status"]) {
  if (status === "resolved") return "Released";
  if (status === "submitted") return "In review";
  return status[0].toUpperCase() + status.slice(1);
}

function initials(email: string) {
  return email.slice(0, 2).toUpperCase();
}

function requiredFunding(details: ProjectDetails) {
  if (details.escrowState) return details.escrowState.requiredFundingWei;
  return (
    details.milestones.reduce((sum, milestone) => sum + BigInt(milestone.amountWei), 0n) +
    BigInt(details.project.feeAmountWei)
  ).toString();
}

function matchesWallet(account: SafeUser | null, wallet: Address | null) {
  if (!account?.walletAddress || !wallet || !isAddress(account.walletAddress)) return false;
  return getAddress(account.walletAddress) === getAddress(wallet);
}

export default function Home() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<SafeUser | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [workspaceRole, setWorkspaceRole] = useState<WorkspaceRole>("client");
  const [wallet, setWallet] = useState<Address | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [details, setDetails] = useState<ProjectDetails | null>(null);
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [draftMilestones, setDraftMilestones] = useState<DraftMilestone[]>([
    { title: "", description: "", amountEth: "" },
  ]);
  const [reputation, setReputation] = useState<ReputationView>(emptyReputation);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const savedToken = window.localStorage.getItem(TOKEN_KEY);
    if (!savedToken) return;
    let active = true;
    void (async () => {
      try {
        const me = await apiRequest<{ user: SafeUser }>("/api/auth/me", { token: savedToken });
        const listed = await apiRequest<{ projects: ProjectSummary[] }>("/api/projects", { token: savedToken });
        if (!active) return;
        setToken(savedToken);
        setUser(me.user);
        const initialRole = me.user.role === "freelancer" ? "freelancer" : "client";
        setWorkspaceRole(initialRole);
        setProjects(listed.projects);
        const initialProject = listed.projects.find((project) =>
          initialRole === "client" ? project.clientId === me.user.id : project.freelancerId === me.user.id,
        );
        if (initialProject) {
          const selected = await apiRequest<{ project: ProjectDetails }>(`/api/projects/${initialProject.id}`, {
            token: savedToken,
          });
          if (active) setDetails(selected.project);
        }
      } catch {
        window.localStorage.removeItem(TOKEN_KEY);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const roleProjects = useMemo(() => {
    if (!user) return [];
    return projects.filter((project) =>
      workspaceRole === "client" ? project.clientId === user.id : project.freelancerId === user.id,
    );
  }, [projects, user, workspaceRole]);

  const resolvedValue = useMemo(
    () =>
      details?.milestones
        .filter((milestone) => milestone.status === "resolved")
        .reduce((sum, milestone) => sum + BigInt(milestone.amountWei), 0n) ?? 0n,
    [details],
  );
  const totalValue = useMemo(
    () => details?.milestones.reduce((sum, milestone) => sum + BigInt(milestone.amountWei), 0n) ?? 0n,
    [details],
  );
  const progress = totalValue === 0n ? 0 : Number((resolvedValue * 100n) / totalValue);
  const walletMatches = matchesWallet(user, wallet);

  async function refreshWorkspace(preferredProjectId?: string) {
    if (!token || !user) return;
    const listed = await apiRequest<{ projects: ProjectSummary[] }>("/api/projects", { token });
    setProjects(listed.projects);
    const roleFiltered = listed.projects.filter((project) =>
      workspaceRole === "client" ? project.clientId === user.id : project.freelancerId === user.id,
    );
    const next = roleFiltered.find((project) => project.id === preferredProjectId) ?? roleFiltered[0];
    if (!next) {
      setDetails(null);
      return;
    }
    const response = await apiRequest<{ project: ProjectDetails }>(`/api/projects/${next.id}`, { token });
    setDetails(response.project);
  }

  async function selectProject(projectId: string) {
    if (!token) return;
    setBusy("project");
    setError(null);
    try {
      const response = await apiRequest<{ project: ProjectDetails }>(`/api/projects/${projectId}`, { token });
      setDetails(response.project);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(null);
    }
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("auth");
    setError(null);
    setMessage(null);
    try {
      const form = new FormData(event.currentTarget);
      const body =
        authMode === "register"
          ? {
              email: String(form.get("email") ?? ""),
              password: String(form.get("password") ?? ""),
              role: String(form.get("role") ?? "both") as AccountRole,
              walletAddress: wallet,
            }
          : {
              email: String(form.get("email") ?? ""),
              password: String(form.get("password") ?? ""),
            };
      if (authMode === "register" && !wallet) {
        throw new Error("Connect MetaMask before creating an account");
      }
      const response = await apiRequest<{ user: SafeUser; accessToken: string }>(`/api/auth/${authMode}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      window.localStorage.setItem(TOKEN_KEY, response.accessToken);
      setToken(response.accessToken);
      setUser(response.user);
      const initialRole = response.user.role === "freelancer" ? "freelancer" : "client";
      setWorkspaceRole(initialRole);
      const listed = await apiRequest<{ projects: ProjectSummary[] }>("/api/projects", {
        token: response.accessToken,
      });
      setProjects(listed.projects);
      const initialProject = listed.projects.find((project) =>
        initialRole === "client" ? project.clientId === response.user.id : project.freelancerId === response.user.id,
      );
      if (initialProject) {
        const selected = await apiRequest<{ project: ProjectDetails }>(`/api/projects/${initialProject.id}`, {
          token: response.accessToken,
        });
        setDetails(selected.project);
      }
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(null);
    }
  }

  async function connectWallet() {
    setBusy("wallet");
    setError(null);
    try {
      const connected = await connectMetaMask();
      setWallet(connected);
      if (user?.walletAddress && getAddress(user.walletAddress) === connected) {
        setReputation(await readReputation(connected));
      }
    } catch (walletError) {
      setError(errorMessage(walletError));
    } finally {
      setBusy(null);
    }
  }

  function logout() {
    window.localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    setWallet(null);
    setProjects([]);
    setDetails(null);
    setReputation(emptyReputation);
    setMessage(null);
  }

  async function changeWorkspace(nextRole: WorkspaceRole) {
    setWorkspaceRole(nextRole);
    if (!token || !user) return;
    const next = projects.find((project) =>
      nextRole === "client" ? project.clientId === user.id : project.freelancerId === user.id,
    );
    if (next) await selectProject(next.id);
    else setDetails(null);
  }

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setBusy("create");
    setError(null);
    try {
      const form = new FormData(event.currentTarget);
      const milestonePayload = draftMilestones.map((milestone) => ({
        title: milestone.title,
        description: milestone.description,
        amountWei: parseEther(milestone.amountEth).toString(),
      }));
      const response = await apiRequest<{ project: ProjectDetails }>("/api/projects", {
        token,
        method: "POST",
        body: JSON.stringify({
          title: String(form.get("title") ?? ""),
          description: String(form.get("description") ?? ""),
          freelancerEmail: String(form.get("freelancerEmail") ?? ""),
          arbiterAddress: String(form.get("arbiterAddress") ?? ""),
          feeAmountWei: parseEther(String(form.get("feeEth") || "0")).toString(),
          milestones: milestonePayload,
        }),
      });
      setDrawer(null);
      setDraftMilestones([{ title: "", description: "", amountEth: "" }]);
      setMessage("Escrow deployed. Fund it from the project workspace when you are ready.");
      await refreshWorkspace(response.project.project.id);
    } catch (requestError) {
      setError(errorMessage(requestError));
      await refreshWorkspace().catch(() => undefined);
    } finally {
      setBusy(null);
    }
  }

  async function fundSelectedEscrow() {
    if (!details?.project.escrowAddress || !wallet || !walletMatches) {
      setError("Connect the client wallet assigned to this project first");
      return;
    }
    setBusy("fund");
    setError(null);
    try {
      await fundEscrow(details.project.escrowAddress, requiredFunding(details), wallet);
      setMessage("Escrow funded on Sepolia. The on-chain state is now active.");
      await refreshWorkspace(details.project.id);
    } catch (fundingError) {
      setError(errorMessage(fundingError));
    } finally {
      setBusy(null);
    }
  }

  async function runMilestoneAction(
    action: "submit" | "approve" | "reject" | "dispute",
    milestone: MilestoneRecord,
    payload: { deliverableUri?: string } = {},
  ) {
    if (!token || !details || !wallet || !walletMatches) {
      setError("Connect the wallet assigned to this account before signing");
      return;
    }
    setBusy(`${action}-${milestone.id}`);
    setError(null);
    try {
      const path = `/api/projects/${details.project.id}/milestones/${milestone.id}/${action}`;
      const prepared = await apiRequest<{
        result: { mode: "wallet_signature"; transaction: PreparedTransaction; deliverableHash?: Hex };
      }>(path, {
        token,
        method: "POST",
        body: JSON.stringify(payload),
      });
      const transactionHash = await sendPreparedTransaction(prepared.result.transaction, wallet);
      await apiRequest(path, {
        token,
        method: "POST",
        body: JSON.stringify({ ...payload, transactionHash }),
      });
      setDrawer(null);
      setMessage(`${milestone.title}: ${action} confirmed on Sepolia.`);
      await refreshWorkspace(details.project.id);
    } catch (actionError) {
      setError(errorMessage(actionError));
    } finally {
      setBusy(null);
    }
  }

  if (!user || !token) {
    return (
      <main className="auth-shell">
        <section className="auth-story">
          <a className="brand brand-light" href="#top" aria-label="FreelanceShield home">
            <span className="brand-mark">FS</span>
            <span>Freelance<span>Shield</span></span>
          </a>
          <div>
            <p className="eyebrow light">MILESTONE ESCROW ON SEPOLIA</p>
            <h1>Work delivered.<br />Payments protected.</h1>
            <p>FreelanceShield keeps project funds in a dedicated smart-contract escrow and releases each milestone only after approval or fair dispute resolution.</p>
          </div>
          <ul className="trust-list">
            <li><span>01</span><div><strong>One escrow per project</strong><small>Gas-efficient ERC-1167 clones isolate every agreement.</small></div></li>
            <li><span>02</span><div><strong>Your wallet stays yours</strong><small>The API prepares transactions; MetaMask signs them.</small></div></li>
            <li><span>03</span><div><strong>Outcomes build reputation</strong><small>Completed and disputed work is recorded on-chain.</small></div></li>
          </ul>
        </section>
        <section className="auth-panel" id="top">
          <div className="auth-card">
            <p className="eyebrow">SECURE ACCOUNT ACCESS</p>
            <h2>{authMode === "login" ? "Welcome back" : "Create your account"}</h2>
            <p className="auth-lead">
              {authMode === "login"
                ? "Sign in to view projects and prepare wallet transactions."
                : "Connect the wallet you will use for escrow actions, then register."}
            </p>
            <div className="auth-tabs" role="tablist" aria-label="Account access">
              <button role="tab" aria-selected={authMode === "login"} onClick={() => setAuthMode("login")}>Sign in</button>
              <button role="tab" aria-selected={authMode === "register"} onClick={() => setAuthMode("register")}>Register</button>
            </div>
            {authMode === "register" && (
              <button className={wallet ? "wallet connected auth-wallet" : "wallet auth-wallet"} onClick={connectWallet} disabled={busy === "wallet"}>
                <span />{busy === "wallet" ? "Connecting…" : wallet ? shortAddress(wallet) : "Connect MetaMask"}
              </button>
            )}
            <form className="auth-form" onSubmit={submitAuth}>
              <label>Email address<input name="email" type="email" autoComplete="email" required placeholder="you@example.com" /></label>
              <label>Password<input name="password" type="password" autoComplete={authMode === "login" ? "current-password" : "new-password"} minLength={10} required placeholder="At least 10 characters" /></label>
              {authMode === "register" && (
                <label>Account role<select name="role" defaultValue="both"><option value="both">Client and freelancer</option><option value="client">Client</option><option value="freelancer">Freelancer</option></select></label>
              )}
              {error && <p className="form-error" role="alert">{error}</p>}
              <button className="primary wide" disabled={busy === "auth"}>{busy === "auth" ? "Please wait…" : authMode === "login" ? "Sign in securely" : "Create account"}</button>
            </form>
            <p className="fine">Passwords are hashed. Wallet private keys never enter FreelanceShield.</p>
          </div>
        </section>
      </main>
    );
  }

  const participant = workspaceRole === "client" ? details?.freelancer : details?.client;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#workspace" aria-label="FreelanceShield workspace"><span className="brand-mark">FS</span><span>Freelance<span>Shield</span></span></a>
        {user.role === "both" && (
          <div className="role-switch" aria-label="Workspace role">
            <button className={workspaceRole === "client" ? "active" : ""} onClick={() => void changeWorkspace("client")}>Client</button>
            <button className={workspaceRole === "freelancer" ? "active" : ""} onClick={() => void changeWorkspace("freelancer")}>Freelancer</button>
          </div>
        )}
        <nav aria-label="Project navigation">
          <p>YOUR PROJECTS</p>
          {roleProjects.map((project) => (
            <button key={project.id} className={details?.project.id === project.id ? "active" : ""} onClick={() => void selectProject(project.id)}>
              <span className={`project-dot ${project.status}`} />
              <span><strong>{project.title}</strong><small>{projectStatus(project.status)}</small></span>
            </button>
          ))}
          {roleProjects.length === 0 && <small className="nav-empty">No {workspaceRole} projects yet.</small>}
        </nav>
        <div className="side-bottom">
          <div className="shield-note"><span>✓</span><div><strong>Sepolia protection</strong><small>Wallet-signed escrow actions</small></div></div>
          <div className="profile"><div className="avatar">{initials(user.email)}</div><div><strong>{user.email}</strong><small>{workspaceRole} workspace</small></div><button onClick={logout} aria-label="Sign out">↪</button></div>
        </div>
      </aside>

      <section className="content" id="workspace">
        <header>
          <div className="mobile-brand"><span className="brand-mark">FS</span> FreelanceShield</div>
          <div className="network-pill"><i /> Sepolia</div>
          <button className={wallet ? "wallet connected" : "wallet"} onClick={connectWallet} disabled={busy === "wallet"}><span />{busy === "wallet" ? "Connecting…" : wallet ? shortAddress(wallet) : "Connect MetaMask"}</button>
        </header>
        <div className="page">
          <div className="welcome">
            <div><p className="eyebrow">{workspaceRole.toUpperCase()} WORKSPACE</p><h1>{workspaceRole === "client" ? "Protect the work. Release with confidence." : "Deliver clearly. Get paid fairly."}</h1><p>{user.email} · {shortAddress(user.walletAddress)}</p></div>
            {workspaceRole === "client" && <button className="primary" onClick={() => setDrawer({ kind: "create" })}><span>+</span> New project</button>}
          </div>

          {!walletMatches && wallet && <div className="alert warning"><strong>Wrong wallet connected.</strong><span>Switch MetaMask to {shortAddress(user.walletAddress)} to sign actions for this account.</span></div>}
          {message && <div className="alert success" role="status"><strong>Confirmed</strong><span>{message}</span><button onClick={() => setMessage(null)} aria-label="Dismiss message">×</button></div>}
          {error && <div className="alert error" role="alert"><strong>Action needed</strong><span>{error}</span><button onClick={() => setError(null)} aria-label="Dismiss error">×</button></div>}

          <section className="metrics" aria-label="Workspace summary">
            <article><p>PROJECTS <span>▱</span></p><strong>{roleProjects.length}</strong><small>{roleProjects.filter((project) => project.status === "active").length} active on Sepolia</small></article>
            <article><p>ESCROW BALANCE <span>⬡</span></p><strong>{formatEth(details?.escrowState?.contractBalanceWei ?? "0")}</strong><small>{details?.escrowState?.funded ? "Funds locked on-chain" : "Awaiting client funding"}</small></article>
            <article><p>{workspaceRole === "client" ? "RELEASED" : "EARNED"} <span>↗</span></p><strong>{formatEth(resolvedValue)}</strong><small>Across resolved milestones</small></article>
            <article><p>REPUTATION <span>◇</span></p><strong>{reputation.score ?? "—"}{reputation.score !== null && <em> / 100</em>}</strong><small>{reputation.available ? `${reputation.completedContracts} completed contracts` : "Available after registry deployment"}</small></article>
          </section>

          {!details ? (
            <section className="empty-state">
              <span>⬡</span>
              <h2>{workspaceRole === "client" ? "Create your first protected project" : "No projects assigned yet"}</h2>
              <p>{workspaceRole === "client" ? "Define milestones, choose a freelancer and arbiter, then deploy a dedicated escrow." : "A project will appear here when a client assigns your registered email and wallet."}</p>
              {workspaceRole === "client" && <button className="primary" onClick={() => setDrawer({ kind: "create" })}>Create project</button>}
            </section>
          ) : (
            <div className="workspace-grid">
              <section className="contract-card">
                <div className="contract-head">
                  <div><span className={`live ${details.project.status}`}>{projectStatus(details.project.status)}</span><span className="chain">⬡ Sepolia</span><h2>{details.project.title}</h2><p>{workspaceRole === "client" ? "Freelancer" : "Client"}: <b>{participant?.email}</b></p></div>
                  <div className="contract-id"><small>ESCROW</small><strong>{shortAddress(details.project.escrowAddress)}</strong></div>
                </div>
                <div className="progress-wrap"><div className="progress-copy"><span>Milestone progress</span><b>{progress}%</b></div><div className="progress"><span style={{ width: `${progress}%` }} /></div><div className="progress-label"><span>{formatEth(resolvedValue)} resolved</span><span>{formatEth(totalValue - resolvedValue)} remaining</span></div></div>
                <div className="milestones">
                  {details.milestones.map((milestone) => {
                    const actionBusy = busy?.endsWith(milestone.id);
                    return (
                      <article className="milestone" key={milestone.id}>
                        <div className={`step ${milestone.status}`} aria-hidden="true">{milestone.status === "resolved" ? "✓" : milestone.position + 1}</div>
                        <div className="milestone-copy"><strong>{milestone.title}</strong><small>{milestone.description || "No additional scope notes"}{milestone.deliverableUri ? ` · ${milestone.deliverableUri}` : ""}</small></div>
                        <span className={`status ${milestone.status}`}>{milestoneStatus(milestone.status)}</span>
                        <b className="amount">{formatEth(milestone.amountWei)}</b>
                        <div className="milestone-actions">
                          {workspaceRole === "client" && milestone.status === "submitted" && <><button className="approve" disabled={actionBusy} onClick={() => void runMilestoneAction("approve", milestone)}>Approve</button><button className="secondary danger-text" disabled={actionBusy} onClick={() => void runMilestoneAction("reject", milestone)}>Reject</button></>}
                          {workspaceRole === "freelancer" && (milestone.status === "pending" || milestone.status === "rejected") && <button className="approve" disabled={actionBusy} onClick={() => setDrawer({ kind: "submit", milestone })}>Submit work</button>}
                          {(milestone.status === "submitted" || milestone.status === "rejected") && <button className="secondary" disabled={actionBusy} onClick={() => setDrawer({ kind: "dispute", milestone })}>Dispute</button>}
                        </div>
                      </article>
                    );
                  })}
                </div>
                <div className="contract-footer">
                  <div><span>◎</span><p><strong>{details.escrowState?.funded ? "Escrow funded" : "Escrow awaits funding"}</strong><small>{formatEth(requiredFunding(details))} total including fee</small></p></div>
                  {workspaceRole === "client" && !details.escrowState?.funded && details.project.escrowAddress && <button className="primary compact" disabled={busy === "fund"} onClick={() => void fundSelectedEscrow()}>{busy === "fund" ? "Confirming…" : "Fund escrow"}</button>}
                </div>
              </section>

              <aside className="details-rail">
                <section className="panel"><div className="panel-title"><h3>Escrow status</h3><span className={details.escrowState?.funded ? "verified" : "pending"}>{details.escrowState?.funded ? "Verified" : "Pending"}</span></div><dl><div><dt>Contract</dt><dd>{shortAddress(details.project.escrowAddress)}</dd></div><div><dt>Required funding</dt><dd>{formatEth(requiredFunding(details))}</dd></div><div><dt>Contract balance</dt><dd>{formatEth(details.escrowState?.contractBalanceWei ?? "0")}</dd></div><div><dt>Remaining milestones</dt><dd>{details.escrowState?.remainingMilestones ?? details.milestones.length}</dd></div><div><dt>Last synced block</dt><dd>{details.escrowState?.lastBlockNumber ?? "Not synced"}</dd></div></dl></section>
                <section className="panel reputation"><div className="panel-title"><h3>On-chain reputation</h3></div><div className="score"><div><strong>{reputation.score ?? "—"}</strong>{reputation.score !== null && <span>/100</span>}</div><p>{reputation.available ? "Registry verified" : "Pending deployment"}<small>{shortAddress(user.walletAddress)}</small></p></div><div className="reputation-stats"><div><b>{reputation.completedContracts}</b><small>Completed</small></div><div><b>{reputation.disputesWon}</b><small>Won</small></div><div><b>{reputation.disputesLost}</b><small>Lost</small></div></div></section>
              </aside>
            </div>
          )}
          {busy === "project" && <p className="loading-line">Reconciling project with Sepolia…</p>}
        </div>
      </section>

      {drawer && (
        <div className="overlay">
          <button className="backdrop" onClick={() => setDrawer(null)} aria-label="Close dialog" />
          <section className="drawer" role="dialog" aria-modal="true" aria-label={drawer.kind === "create" ? "Create project" : drawer.kind === "submit" ? "Submit milestone" : "Raise dispute"}>
            <button className="close" onClick={() => setDrawer(null)} aria-label="Close dialog">×</button>
            {drawer.kind === "create" && (
              <form onSubmit={createProject}>
                <p className="eyebrow">NEW PROTECTED PROJECT</p><h2>Deploy a milestone escrow</h2><p className="drawer-lead">The server creates a dedicated ERC-1167 escrow clone. You fund it from MetaMask after deployment.</p>
                <label>Project title<input name="title" required maxLength={160} placeholder="e.g. Product landing page" /></label>
                <label>Brief<textarea name="description" rows={3} maxLength={8000} placeholder="Describe the outcome and acceptance criteria" /></label>
                <label>Freelancer account email<input name="freelancerEmail" type="email" required placeholder="freelancer@example.com" /></label>
                <label>Designated arbiter address<input name="arbiterAddress" required placeholder="0x…" /></label>
                <label>Platform fee in ETH<input name="feeEth" type="number" min="0" step="0.000001" defaultValue="0" required /></label>
                <div className="milestone-editor">
                  <div className="editor-head"><strong>Milestones</strong><button type="button" onClick={() => setDraftMilestones((items) => [...items, { title: "", description: "", amountEth: "" }])}>+ Add</button></div>
                  {draftMilestones.map((milestone, index) => <div className="draft-milestone" key={index}><span>{index + 1}</span><input aria-label={`Milestone ${index + 1} title`} required placeholder="Milestone title" value={milestone.title} onChange={(event) => setDraftMilestones((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} /><input aria-label={`Milestone ${index + 1} amount in ETH`} required type="number" min="0.000001" step="0.000001" placeholder="ETH" value={milestone.amountEth} onChange={(event) => setDraftMilestones((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, amountEth: event.target.value } : item))} />{draftMilestones.length > 1 && <button type="button" aria-label={`Remove milestone ${index + 1}`} onClick={() => setDraftMilestones((items) => items.filter((_, itemIndex) => itemIndex !== index))}>×</button>}</div>)}
                </div>
                {error && <p className="form-error" role="alert">{error}</p>}
                <button className="primary wide" disabled={busy === "create"}>{busy === "create" ? "Deploying escrow…" : "Create project & escrow"}</button>
              </form>
            )}
            {drawer.kind === "submit" && (
              <form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void runMilestoneAction("submit", drawer.milestone, { deliverableUri: String(form.get("deliverableUri") ?? "") }); }}>
                <p className="eyebrow">FREELANCER DELIVERY</p><h2>Submit {drawer.milestone.title}</h2><p className="drawer-lead">Add an IPFS, repository, or review URL. FreelanceShield hashes it into the wallet-signed transaction.</p><label>Deliverable URL<input name="deliverableUri" required maxLength={2048} placeholder="ipfs://… or https://…" /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary wide" disabled={busy === `submit-${drawer.milestone.id}`}>{busy ? "Waiting for confirmation…" : "Sign submission in MetaMask"}</button>
              </form>
            )}
            {drawer.kind === "dispute" && (
              <div><p className="eyebrow danger-text">RESOLUTION CENTER</p><h2>Dispute {drawer.milestone.title}</h2><p className="drawer-lead">This changes the milestone to disputed and opens a case for the project’s designated arbiter. Evidence exchange is outside this portfolio demo.</p><div className="dispute-summary"><span>Milestone value</span><strong>{formatEth(drawer.milestone.amountWei)}</strong></div>{error && <p className="form-error" role="alert">{error}</p>}<button className="danger wide" disabled={busy === `dispute-${drawer.milestone.id}`} onClick={() => void runMilestoneAction("dispute", drawer.milestone)}>{busy ? "Waiting for confirmation…" : "Raise dispute in MetaMask"}</button>
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
