const EXPLICIT_REGENERATION_PATTERN =
    /重新生成|重新给我生成|重新做|重做|从头生成|从头做|完全重新|换一个界面|换个界面|new design|regenerate|start over|from scratch/iu;

const CHINESE_FULL_APP_NOUN_PATTERN =
    /(?:后台|看板|仪表盘|控制台|监控台|工作台|管理台|网站|网页|官网|首页|主页|专题页|落地页|作品集|商城|门户|应用|界面|页面|大屏)/u;

const ENGLISH_FULL_APP_NOUN_PATTERN =
    /\b(?:dashboard|console|admin(?:istration)?\s+(?:panel|portal)|back\s*office|control\s+panel|monitoring\s+screen|website|webpage|homepage|landing\s+page|portfolio|storefront|portal|application|app|interface|page|screen|site|spa)\b/iu;

const CHINESE_FULL_APP_CREATION_PATTERN =
    /^(?:请)?(?:帮我)?(?:创建|生成|制作|设计|构建|开发|做)(?:一个|一套|一页)?[^\n。！？]{0,120}(?:后台|看板|仪表盘|控制台|监控台|工作台|管理台|网站|网页|官网|首页|主页|专题页|落地页|作品集|商城|门户|应用|界面|页面|大屏)(?:[，,].*)?$/iu;

const ENGLISH_FULL_APP_CREATION_PATTERN =
    /^(?:please\s+)?(?:create|generate|make|design|build|develop)\s+(?:a|an|the)?\s*[^\n.!?]{0,120}\b(?:dashboard|console|admin(?:istration)?\s+(?:panel|portal)|back\s*office|control\s+panel|monitoring\s+screen|website|webpage|homepage|landing\s+page|portfolio|storefront|portal|application|app|interface|page|screen|site|spa)\b/iu;

const READABLE_CHINESE_FULL_APP_NOUN_PATTERN =
    /(?:后台|看板|仪表盘|控制台|监控台|工作台|管理台|网站|网页|官网|首页|主页|专题页|落地页|作品集|商城|门户|应用|界面|页面|大屏)/u;

const READABLE_CHINESE_FULL_APP_CREATION_PATTERN =
    /^(?:请)?(?:帮我)?(?:整体)?(?:创建|生成|制作|设计|构建|开发|做|搞|重做|重新做|重新生成|换一个|换个)[\s\S]{0,160}(?:后台|看板|仪表盘|控制台|监控台|工作台|管理台|网站|网页|官网|首页|主页|专题页|落地页|作品集|商城|门户|应用|界面|页面|大屏)/u;

const READABLE_CHINESE_REGENERATION_PATTERN =
    /(?:重新生成|重新给我生成|重新做|重做|从头生成|从头做|完全重新|换一个界面|换个界面|整体重做|整体重新)/u;

/**
 * Returns true when the text describes a whole page/application rather than a
 * small component. This is intentionally noun-based because the runner also
 * uses it for initial queued goals where no continuation verb is required.
 */
export function isFreshPageGenerationRequest(text: string): boolean {
    return (
        READABLE_CHINESE_FULL_APP_NOUN_PATTERN.test(text) ||
        CHINESE_FULL_APP_NOUN_PATTERN.test(text) ||
        ENGLISH_FULL_APP_NOUN_PATTERN.test(text)
    );
}

/**
 * Returns true for a continuation request that clearly asks to replace the
 * current application. Component-level requests such as “创建一个告警列表模块”
 * deliberately remain false.
 */
export function isFullApplicationCreationRequest(text: string): boolean {
    const normalized = text.trim();
    return (
        READABLE_CHINESE_FULL_APP_CREATION_PATTERN.test(normalized) ||
        CHINESE_FULL_APP_CREATION_PATTERN.test(normalized) ||
        ENGLISH_FULL_APP_CREATION_PATTERN.test(normalized)
    );
}

export function isExplicitRegenerationPrompt(text: string): boolean {
    const normalized = text.trim();
    return (
        READABLE_CHINESE_REGENERATION_PATTERN.test(normalized) ||
        EXPLICIT_REGENERATION_PATTERN.test(normalized) ||
        isFullApplicationCreationRequest(normalized)
    );
}
