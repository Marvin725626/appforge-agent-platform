import type {
    ImageAssetProvider,
    ImageAssetRequest,
    ImageAssetResult,
} from "./image-asset-provider.js";
import { WebImageAssetProvider } from "./web-image-asset-provider.js";

export type SearchImageAssetProviderOptions = {
    timeoutMs?: number;
    maxResults?: number;
    searchUrlTemplate?: string;
};

function containsUrl(text: string): boolean {
    return /https?:\/\/[^\s"'<>]+/u.test(text);
}

function decodeHtml(value: string): string {
    return value
        .replace(/&amp;/gu, "&")
        .replace(/&quot;/gu, '"')
        .replace(/&#x27;/gu, "'")
        .replace(/&#39;/gu, "'")
        .replace(/&lt;/gu, "<")
        .replace(/&gt;/gu, ">");
}

function normalizeSearchResultUrl(rawHref: string): string | undefined {
    const decoded = decodeHtml(rawHref);

    try {
        const url = new URL(decoded, "https://duckduckgo.com");
        const redirected = url.searchParams.get("uddg");

        if (redirected) {
            return redirected;
        }

        if (url.protocol === "http:" || url.protocol === "https:") {
            return url.toString();
        }
    } catch {
        return undefined;
    }

    return undefined;
}

function extractResultUrls(html: string): string[] {
    const urls = [
        ...html.matchAll(/<a\b[^>]*class\s*=\s*["'][^"']*result__a[^"']*["'][^>]*href\s*=\s*["']([^"']+)["'][^>]*>/giu),
        ...html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*class\s*=\s*["'][^"']*result__a[^"']*["'][^>]*>/giu),
    ]
        .map((match) => normalizeSearchResultUrl(match[1] ?? ""))
        .filter((url): url is string => url !== undefined)
        .filter((url) => /^https?:\/\//u.test(url));

    return [...new Set(urls)];
}

function formatSearchUrl(query: string, template?: string): string {
    if (template) {
        return template.replace(/\{q\}/gu, encodeURIComponent(query));
    }

    return `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
}

export class SearchImageAssetProvider implements ImageAssetProvider {
    constructor(
        private readonly options: SearchImageAssetProviderOptions = {},
    ) {}

    async getImage(
        request: ImageAssetRequest,
        signal?: AbortSignal,
    ): Promise<ImageAssetResult> {
        signal?.throwIfAborted();
        if (request.mode !== "search") {
            throw new Error(
                "SearchImageAssetProvider only supports search mode",
            );
        }

        if (containsUrl(request.query)) {
            throw new Error(
                "SearchImageAssetProvider handles keyword searches only",
            );
        }

        const timeoutMs = this.options.timeoutMs ?? 30_000;
        const controller = new AbortController();
        let timedOut = false;
        const abortFromRequest = () => controller.abort(signal?.reason);
        signal?.addEventListener("abort", abortFromRequest, { once: true });
        if (signal?.aborted) {
            abortFromRequest();
        }
        const timeout = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, timeoutMs);

        try {
            const query = `${request.query} official logo svg png`;
            const response = await fetch(
                formatSearchUrl(query, this.options.searchUrlTemplate),
                {
                    headers: {
                        "User-Agent":
                            "AppForgeAgentPlatform/0.1 brand-search",
                    },
                    signal: controller.signal,
                },
            );

            if (!response.ok) {
                throw new Error(
                    `Search request failed with ${response.status}`,
                );
            }

            const urls = extractResultUrls(await response.text()).slice(
                0,
                this.options.maxResults ?? 5,
            );

            if (urls.length === 0) {
                throw new Error("Search returned no usable result URLs");
            }

            const webProvider = new WebImageAssetProvider({ timeoutMs });
            const errors: string[] = [];

            for (const url of urls) {
                signal?.throwIfAborted();
                try {
                    return await webProvider.getImage(
                        {
                            ...request,
                            query: `${request.query} ${url}`,
                        },
                        signal,
                    );
                } catch (error) {
                    errors.push(
                        error instanceof Error
                            ? error.message
                            : String(error),
                    );
                }
            }

            throw new Error(
                `Search result pages did not provide a usable image: ${errors.join(" | ")}`,
            );
        } catch (error) {
            if (signal?.aborted) {
                signal.throwIfAborted();
            }

            if (
                timedOut ||
                (error instanceof DOMException &&
                    error.name === "AbortError")
            ) {
                throw new Error(
                    `Search image request timed out after ${timeoutMs}ms`,
                );
            }

            throw error;
        } finally {
            clearTimeout(timeout);
            signal?.removeEventListener("abort", abortFromRequest);
        }
    }
}
