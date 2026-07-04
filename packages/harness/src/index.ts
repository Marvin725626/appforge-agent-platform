export type HarnessCheck = {
    name:string;
    passed:boolean;
};

export type HarnessResult = {
    passed:boolean;
    checks:HarnessCheck[];
};

export type EvalCheck = HarnessCheck;

export type ReactAppEvalResult = HarnessResult;

export type EvaluateReactAppInput = {
    source:string;
    goal?: string;
};

const COMMON_MOJIBAKE_PATTERNS = [
    "\u95b9",
    "\u6fde",
    "\u95bb",
    "\u7eee",
    "\u95bf",
    "\u5a11",
    "\u5a34",
    "\u7f01",
    "\u951f",
    "\u93b4",
    "\u6d93",
    "\u7c99",
    "\u9423",
];

export function evaluateChecks(checks:HarnessCheck[]):HarnessResult{
    return {
        passed: checks.every((check) => check.passed),
        checks,
    };
}

export function containsChinese(text: string | undefined): boolean {
    return /[\u4e00-\u9fff]/u.test(text ?? "");
}

export function containsLikelyMojibake(text: string): boolean {
    const matches = COMMON_MOJIBAKE_PATTERNS.filter((pattern) =>
        text.includes(pattern),
    );

    return matches.length >= 2;
}

function isTaskAppGoal(goal: string | undefined): boolean {
    const normalizedGoal = (goal ?? "task").toLowerCase();

    return (
        normalizedGoal.includes("task") ||
        normalizedGoal.includes("todo") ||
        normalizedGoal.includes("to-do") ||
        normalizedGoal.includes("list") ||
        normalizedGoal.includes("任务") ||
        normalizedGoal.includes("待办") ||
        normalizedGoal.includes("清单")
    );
}

function isContentPageGoal(goal: string | undefined): boolean {
    const normalizedGoal = (goal ?? "").toLowerCase();

    return (
        normalizedGoal.includes("introduction") ||
        normalizedGoal.includes("introduce") ||
        normalizedGoal.includes("about") ||
        normalizedGoal.includes("page") ||
        normalizedGoal.includes("介绍") ||
        normalizedGoal.includes("页面")
    );
}

function createLanguageChecks(input: EvaluateReactAppInput): EvalCheck[] {
    if (!containsChinese(input.goal)) {
        return [];
    }

    return [
        {
            name: "matches requested language",
            passed: containsChinese(input.source),
        },
    ];
}

function shouldUseTaskAppChecks(input: EvaluateReactAppInput): boolean {
    if (isTaskAppGoal(input.goal)) {
        return true;
    }

    if (isContentPageGoal(input.goal)) {
        return false;
    }

    if (
        (input.source.includes("<h1") || input.source.includes("<h2")) &&
        input.source.includes("<p")
    ) {
        return false;
    }

    return true;
}

export function evaluateReactApp(
    input: EvaluateReactAppInput,
): ReactAppEvalResult {
    const checks: EvalCheck[] = [
        {
            name: "has readable text",
            passed: !containsLikelyMojibake(input.source),
        },
        ...createLanguageChecks(input),
        ...(shouldUseTaskAppChecks(input)
            ? [
                  {
                      name: "has input",
                      passed: input.source.includes("<input"),
                  },
                  {
                      name: "has button",
                      passed: input.source.includes("<button"),
                  },
                  {
                      name: "has task rendering",
                      passed:
                          input.source.includes(".map(") ||
                          input.source.includes("map(( "),
                  },
              ]
            : [
                  {
                      name: "has heading",
                      passed:
                          input.source.includes("<h1") ||
                          input.source.includes("<h2"),
                  },
                  {
                      name: "has descriptive paragraphs",
                      passed: input.source.includes("<p"),
                  },
                  {
                      name: "has enough page content",
                      passed: input.source.length >= 200,
                  },
              ]),
    ];

    return evaluateChecks(checks);
}
