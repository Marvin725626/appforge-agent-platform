export type Skill = {
    id: string;
    name: string;
    description: string;
    instructions: string[];
};
export const reactViteAppSkill: Skill = {
    id: "react-vite-app",
    name: "React Vite App",
    description: "Generate buildable React/Vite TypeScript apps.",
    instructions: [
        "The workspace is an existing Vite React TypeScript project.",
        "Return only valid JSON actions.",
        "Treat a request to create a page, website, homepage, landing page, or introduction interface as a complete polished page by default. Only reduce it to a minimal, simple, prototype, or single-screen result when the user explicitly asks for that constraint.",
        "Adapt the complete-page shell to the product type. Content, official-site, landing, and introduction pages need a clear high-contrast brand, useful navigation, a topic-specific hero, at least three distinct meaningful content sections beyond the hero, and a finished footer.",
        "Dashboards, portals, and embedded tools may instead use a coherent app shell with product identity, task-appropriate navigation, a summary header or overview, at least three meaningful functional modules, and an appropriate utility, status, or footer treatment; do not force a marketing hero or marketing footer onto them.",
        "Use real subject-specific content, never lorem ipsum, generic Feature 1 cards, empty shells, or placeholder copy.",
        "For explicitly minimal apps, first write src/App.tsx using a write_file action.",
        "For complete or complex pages, define the information architecture and route map first, then split content, CSS, and compact reusable components across focused files. Use append_file when a file needs to be written in chunks.",
        "Use a small coherent CSS design-token system for color, typography, spacing, radius, and shadow, with clear page, heading, content, and action hierarchy.",
        "Keep brand marks and logos high-contrast, with a solid-color surface fallback when imagery or gradients fail.",
        "Define explicit readable foreground/background pairs before styling components. Safe defaults: dark surface #071018 with text #f8fbff; bright cyan #7cf7ff with text #071018; warm yellow #ffd166 with text #061018; white/off-white surfaces with text #111827. Never put white or pale text on bright cyan, warm yellow, white, beige, or light gradients.",
        "Every badge, kicker, eyebrow, HUD pill, stat, metric, table header, table cell, nav item, and CTA must use one of those readable pairs. If a component uses a gradient, assign text color based on the lightest visible stop, not the darkest stop.",
        "Use semantic native links and buttons, at least 44px interaction targets, visible :focus-visible styles, and no nested interactive controls.",
        "Support mobile and desktop layouts without horizontal overflow, and respect prefers-reduced-motion.",
        "Use only assets essential to the requested experience, keep required assets reliable, and give meaningful images useful alt text; do not invent optional decorative assets.",
        "src/main.tsx imports a named export with `import { App } from \"./App.js\"`, so src/App.tsx must export `App` as a named export.",
        "Do not use only `export default App`.",
        "All user-facing UI text and page content must use the same natural language as the user's goal.",
        "If the goal is Chinese, write Chinese UI text and page content.",
        "Do not translate the user's requested app into English unless the user asks for English.",
        'Use ordinary #section anchors only for same-page navigation. For independent or multiple pages, implement distinct URL-backed route views with substantial route-specific content, active navigation state, direct deep-link loading, and browser Back/Forward support; pathname routes and URL-aware #/ hash routes are valid, but href="#" is never a route.',
        "For iterations, preserve the existing design language and working behavior, then make the smallest coherent change that satisfies the new request.",
        "Before returning finish, self-check that the requested information architecture, product-appropriate complete-page or app-shell structure, topic-specific content or functional modules, responsive styling, accessibility, and every requested route are implemented. The existence of src/App.tsx alone is not completion.",
        "Do not edit package.json.",
    ],
};
export const visualDesignSkill: Skill = {
    id: "visual-design-system",
    name: "Visual Design System",
    description:
        "Create subject-specific, accessible, responsive web interfaces without collapsing every request into the same block/card template.",
    instructions: [
        "Use the frontend-design template pack before writing UI: define design tokens, pick a subject-specific layout blueprint, then implement semantic accessible components. Do not start from visual decoration or repeated boxes.",
        "Use a three-tier token system: primitives such as ink/surface/accent/warm, semantic tokens such as background/foreground/primary/muted/border, and component tokens such as header-height/card-padding/control-height/radius/shadow. Components must consume semantic/component tokens instead of random hardcoded colors.",
        "Use type-scale tokens instead of arbitrary font sizes: body around .92-1rem, h2 around 1.25-1.75rem, hero h1 normally 2-3.8rem, game hero h1 max about 4rem, large metrics normally 1.55-2.6rem. Do not use giant poster typography unless explicitly requested.",
        "Use spacing/layout tokens consistently: page gutters, section gaps, media max-height, control height at least 44px, and responsive breakpoints. Images and media panels must not dominate adjacent text or create tall empty columns.",
        "Use semantic HTML and accessible interaction by default: nav/main/article/section/header/footer, real links/buttons, visible focus-visible styles, no nested interactive controls, and meaningful image alt text.",
        "Maintain WCAG-style readable foreground/background pairs for text. Normal text should target 4.5:1 contrast; large display text and UI components should remain clearly readable. If the browser warning is non-blocking, still design as if contrast matters.",
        "Infer the subject's visual identity before layout: brand cues, domain conventions, signature colors, shapes, content rhythm, terminology, and user intent.",
        "Never collapse unrelated requests into the same block/card template.",
        "Do not reuse the same navigation, badge, logo placeholder, hero split, rounded blocks, grid rhythm, or section pattern across unrelated topics.",
        "Cards, panels, tiles, and metrics are allowed only when they are native to the product type; they must not become the dominant structure of every page.",
        "For games and esports, prefer cinematic stages, HUD strips, maps, loadouts, round timelines, rails, terminal overlays, sharp dividers, and compact readable type. Avoid stacks of isolated rounded boxes.",
        "For dark/HUD/game styling, neon or pale accent text must sit on dark opaque surfaces. Never put cyan, yellow, white, or pastel text directly on light gradients, pale photos, or translucent light panels without a dark backing or text shadow that preserves readable contrast.",
        "For game UI, use strict contrast pairs: dark HUD/panel/table background #071018 or #16090a with #f8fbff text; for Valorant-style pages prefer red/amber HUD chips #ff4655 or #f6b35b with #16090a text. Do not default to large cyan/blue chips unless the subject explicitly calls for that palette, and do not use translucent panels for body copy unless there is an opaque dark backing behind the text.",
        "For tables and tactical matrices, style th/td explicitly: Valorant-style headers on #f6b35b with #16090a text, body cells on #071018 with #f8fbff text, or the inverse for light editorial pages. Do not leave table text to inherit from a decorative parent.",
        "For kicker/eyebrow labels, use a badge-like readable pair such as #ffd166 background with #061018 text or #071018 background with #f8fbff text. Do not leave tiny uppercase labels as pale accent text on gradients.",
        "For tactical-map or site labels, never write raw slash-separated point text such as A / B / C in a narrow cell or column. Render A, B, and C as separate horizontal chips or labels, grouped in one row or wrapping as whole chips; never allow short labels to become vertical one-character columns unless the user explicitly asks for vertical writing.",
        "Avoid noisy decorative punctuation in visible copy, especially trailing //, ::, --, or repeated separators in headings and labels. Use CSS borders, rules, icons, or spacing for decoration instead of literal punctuation that can read as broken characters.",
        "For city, culture, tourism, and institution pages, prefer editorial flow, map/list hybrids, routes, wide story bands, local texture, timelines, and magazine rhythm instead of uniform cards.",
        "For dashboards, use operational app-shell density: filters, tables, charts, KPI rows, feeds, status rails, and split panes.",
        "For ecommerce, use product stages, buying panels, price/spec strips, comparison rows, trust stacks, and product tiles only where they support purchase decisions.",
        "For SaaS/product sites, use product screens, workflow lanes, feature strips, proof rows, and conversion surfaces.",
        "For portfolios, use curated project walls, case-study spreads, profile blocks, gallery rhythm, captions, and varied scale.",
        "Control typography aggressively: headings must fit their container, body text must meet WCAG-like contrast expectations, long Chinese/English labels must wrap, and no content should be clipped or hidden by decorative layout.",
        "Use design tokens consistently and keep mobile/desktop layouts free of horizontal overflow.",
        "If official or existing brand assets are relevant, search or fetch them as local assets before falling back to generated or geometric placeholders.",
    ],
};
export function formatSkillInstructions(skill:Skill):string{
    return [
        `Skill: ${skill.name}`,
        skill.description,
        "",
        "Instructions:",
        ...skill.instructions.map((instruction) => `- ${instruction}`),
    ].join("\n");
}
