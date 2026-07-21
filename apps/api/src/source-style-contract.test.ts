import { describe, expect, it } from "vitest";

import { evaluateSourceStyleContract } from "./source-style-contract.js";

describe("source style contract", () => {
    it("rejects a JSX/CSS pair assembled from incompatible drafts", () => {
        const result = evaluateSourceStyleContract({
            appSource: `
                import "./App.css";
                export function App() {
                    return <div className="ops-shell">
                        <header className="topbar">
                            <div className="brand-block" />
                            <nav className="top-nav" />
                            <div className="top-actions" />
                        </header>
                        <main className="dashboard-main">
                            <section className="section-block metrics-section" />
                        </main>
                    </div>;
                }
            `,
            cssSource: `
                .app-shell { min-height: 100vh; }
                .topbar { display: flex; }
                .brand { display: flex; }
                .topnav { display: flex; }
                .dashboard { display: grid; }
                .section { padding: 1rem; }
            `,
        });

        expect(result.applicable).toBe(true);
        expect(result.passed).toBe(false);
        expect(result.rootClass).toBe("ops-shell");
        expect(result.evidence).toContain("Root class .ops-shell");
        expect(result.missingClasses).toContain("dashboard-main");
    });

    it("accepts a coherent JSX/CSS pair", () => {
        const result = evaluateSourceStyleContract({
            appSource: `
                import "./App.css";
                export function App() {
                    return <div className="ops-shell">
                        <header className="topbar">
                            <div className="brand-block" />
                            <nav className="top-nav" />
                        </header>
                        <main className="dashboard-main">
                            <section className="section-block metrics-section" />
                        </main>
                    </div>;
                }
            `,
            cssSource: `
                .ops-shell { min-height: 100vh; }
                .topbar { display: flex; }
                .brand-block { display: flex; }
                .top-nav { display: flex; }
                .dashboard-main { display: grid; }
                .section-block { padding: 1rem; }
                .metrics-section { min-width: 0; }
            `,
        });

        expect(result.applicable).toBe(true);
        expect(result.passed).toBe(true);
        expect(result.coverage).toBe(1);
    });

    it("does not block pages that do not use App.css class styling", () => {
        const result = evaluateSourceStyleContract({
            appSource:
                "export function App(){return <main style={{padding: 20}}><h1>页面</h1></main>}",
            cssSource: "",
        });

        expect(result.applicable).toBe(false);
        expect(result.passed).toBe(true);
    });
});
