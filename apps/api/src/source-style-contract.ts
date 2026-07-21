export type SourceStyleContractResult = {
    applicable: boolean;
    passed: boolean;
    coverage: number;
    rootClass?: string;
    missingClasses: string[];
    evidence: string;
};

const DYNAMIC_STATE_CLASSES = new Set([
    "active",
    "selected",
    "current",
    "open",
    "closed",
    "done",
    "pending",
    "processing",
    "healthy",
    "warning",
    "critical",
    "danger",
    "success",
    "error",
    "small",
    "large",
    "secondary",
    "primary",
    "compact",
    "mobile",
]);

function collectJsxClassNames(source: string): string[] {
    const names = new Set<string>();
    const literalPattern = /className\s*=\s*["']([^"']+)["']/gu;
    const templatePattern = /className\s*=\s*\{`([^`]+)`\}/gu;

    const addTokens = (value: string) => {
        for (const token of value
            .replace(/\$\{[^}]*\}/gu, " ")
            .split(/\s+/u)
            .map((part) => part.trim())
            .filter(Boolean)) {
            if (/^[A-Za-z_][\w-]*$/u.test(token)) {
                names.add(token);
            }
        }
    };

    for (const match of source.matchAll(literalPattern)) {
        addTokens(match[1] ?? "");
    }
    for (const match of source.matchAll(templatePattern)) {
        addTokens(match[1] ?? "");
    }

    return [...names];
}

function collectCssClassNames(source: string): Set<string> {
    const names = new Set<string>();
    for (const match of source.matchAll(/\.([A-Za-z_][\w-]*)/gu)) {
        const name = match[1];
        if (name) {
            names.add(name);
        }
    }
    return names;
}

function findRootClass(source: string): string | undefined {
    const returnIndex = source.indexOf("return (");
    const relevantSource = returnIndex >= 0 ? source.slice(returnIndex) : source;
    const match = relevantSource.match(
        /<[A-Za-z][^>]*\bclassName\s*=\s*["']([^"']+)["']/u,
    );
    return match?.[1]?.split(/\s+/u).find(Boolean);
}

export function evaluateSourceStyleContract(input: {
    appSource: string;
    cssSource: string;
}): SourceStyleContractResult {
    const importsProjectCss = /import\s+["']\.\/App\.css["']/u.test(
        input.appSource,
    );
    const jsxClasses = collectJsxClassNames(input.appSource).filter(
        (name) => !DYNAMIC_STATE_CLASSES.has(name),
    );

    if (!importsProjectCss || jsxClasses.length < 5) {
        return {
            applicable: false,
            passed: true,
            coverage: 1,
            missingClasses: [],
            evidence:
                "Source/CSS class contract was not applicable to this page.",
        };
    }

    const cssClasses = collectCssClassNames(input.cssSource);
    const rootClass = findRootClass(input.appSource);
    const missingClasses = jsxClasses.filter((name) => !cssClasses.has(name));
    const coveredCount = jsxClasses.length - missingClasses.length;
    const coverage = coveredCount / jsxClasses.length;
    const rootClassCovered = !rootClass || cssClasses.has(rootClass);
    const passed = rootClassCovered && coverage >= 0.68;
    const sample = missingClasses.slice(0, 10);

    return {
        applicable: true,
        passed,
        coverage,
        ...(rootClass ? { rootClass } : {}),
        missingClasses,
        evidence: passed
            ? `Project CSS covers ${(coverage * 100).toFixed(0)}% of static JSX classes${rootClass ? ` and styles root .${rootClass}` : ""}.`
            : [
                  `Project CSS covers only ${(coverage * 100).toFixed(0)}% of static JSX classes.`,
                  rootClass && !rootClassCovered
                      ? `Root class .${rootClass} has no CSS selector.`
                      : "",
                  sample.length > 0
                      ? `Missing selectors include: ${sample.map((name) => `.${name}`).join(", ")}.`
                      : "",
              ]
                  .filter(Boolean)
                  .join(" "),
    };
}
