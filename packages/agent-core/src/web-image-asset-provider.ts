import type {
    ImageAssetProvider,
    ImageAssetRequest,
    ImageAssetResult,
    ImageMediaType,
} from "./image-asset-provider.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_HTML_BYTES = 1 * 1024 * 1024;
const DEFAULT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_EXTENSIONS = [
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".svg",
];

export type WebImageAssetProviderOptions = {
    timeoutMs?: number;
    maxHtmlBytes?: number;
    maxImageBytes?: number;
    allowedHosts?: string[];
};

type ImageCandidate = {
    url: string;
    alt: string;
};

function detectImageMediaType(
    data: Uint8Array,
): ImageMediaType {
    const isPng =
        data.length >= 8 &&
        data[0] === 137 &&
        data[1] === 80 &&
        data[2] === 78 &&
        data[3] === 71;

    if (isPng) {
        return "image/png";
    }

    const isJpeg =
        data.length >= 3 &&
        data[0] === 255 &&
        data[1] === 216 &&
        data[2] === 255;

    if (isJpeg) {
        return "image/jpeg";
    }

    const isWebp =
        data.length >= 12 &&
        data[0] === 82 &&
        data[1] === 73 &&
        data[2] === 70 &&
        data[3] === 70 &&
        data[8] === 87 &&
        data[9] === 69 &&
        data[10] === 66 &&
        data[11] === 80;

    if (isWebp) {
        return "image/webp";
    }

    const prefix = new TextDecoder("utf-8", {
        fatal: false,
    }).decode(data.slice(0, Math.min(data.byteLength, 512)));
    if (/<svg\b/iu.test(prefix)) {
        return "image/svg+xml";
    }

    throw new Error(
        "Downloaded file is not a supported PNG, JPEG, WebP, or SVG image",
    );
}

function extractFirstUrl(text: string): URL {
    const match = /https?:\/\/[^\s"'<>]+/u.exec(text);

    if (!match) {
        throw new Error(
            "Web image search requires an http(s) page URL or direct image URL in the query",
        );
    }

    return new URL(match[0].replace(/[),.，。]+$/u, ""));
}

function isBlockedHost(hostname: string): boolean {
    const host = hostname.toLowerCase();

    return (
        host === "localhost" ||
        host === "0.0.0.0" ||
        host === "::1" ||
        host.startsWith("127.") ||
        host.startsWith("10.") ||
        host.startsWith("192.168.") ||
        /^172\.(1[6-9]|2\d|3[0-1])\./u.test(host)
    );
}

function validateUrl(
    url: URL,
    allowedHosts?: string[],
): void {
    if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new Error("Only http(s) URLs are allowed");
    }

    if (isBlockedHost(url.hostname)) {
        throw new Error("Local and private network URLs are not allowed");
    }

    if (
        allowedHosts &&
        allowedHosts.length > 0 &&
        !allowedHosts.includes(url.hostname)
    ) {
        throw new Error(
            `Host is not allowed for web image search: ${url.hostname}`,
        );
    }
}

function looksLikeImageUrl(url: URL): boolean {
    return IMAGE_EXTENSIONS.some((extension) =>
        url.pathname.toLowerCase().endsWith(extension),
    );
}

function getAttribute(
    tag: string,
    name: string,
): string | undefined {
    const pattern = new RegExp(
        `${name}\\s*=\\s*["']([^"']+)["']`,
        "iu",
    );
    const match = pattern.exec(tag);

    return match?.[1];
}

function extractImageCandidates(
    html: string,
    baseUrl: URL,
): ImageCandidate[] {
    const images = [...html.matchAll(/<img\b[^>]*>/giu)]
        .map((match) => {
            const tag = match[0];
            const src =
                getAttribute(tag, "src") ??
                getAttribute(tag, "data-src") ??
                getAttribute(tag, "data-original");

            if (!src) {
                return undefined;
            }

            try {
                return {
                    url: new URL(src, baseUrl).toString(),
                    alt: getAttribute(tag, "alt") ?? "",
                };
            } catch {
                return undefined;
            }
        })
        .filter(
            (candidate): candidate is ImageCandidate =>
                candidate !== undefined,
        );
    const metadata = [
        ...html.matchAll(/<meta\b[^>]*(?:property|name)\s*=\s*["'](?:og:image|twitter:image|twitter:image:src)["'][^>]*>/giu),
        ...html.matchAll(/<meta\b[^>]*content\s*=\s*["'][^"']+["'][^>]*(?:property|name)\s*=\s*["'](?:og:image|twitter:image|twitter:image:src)["'][^>]*>/giu),
        ...html.matchAll(/<link\b[^>]*rel\s*=\s*["'][^"']*(?:icon|apple-touch-icon)[^"']*["'][^>]*>/giu),
    ]
        .map((match) => {
            const tag = match[0];
            const src =
                getAttribute(tag, "content") ??
                getAttribute(tag, "href");

            if (!src) {
                return undefined;
            }

            try {
                return {
                    url: new URL(src, baseUrl).toString(),
                    alt:
                        getAttribute(tag, "alt") ??
                        getAttribute(tag, "rel") ??
                        "",
                };
            } catch {
                return undefined;
            }
        })
        .filter(
            (candidate): candidate is ImageCandidate =>
                candidate !== undefined,
        );

    return [...metadata, ...images];
}

function scoreCandidate(
    candidate: ImageCandidate,
    request: ImageAssetRequest,
): number {
    const text = `${candidate.url} ${candidate.alt}`.toLowerCase();
    const query = `${request.query} ${request.altText}`.toLowerCase();
    const tokens = query
        .split(/[^a-z0-9\u4e00-\u9fff]+/u)
        .filter((token) => token.length >= 2);

    const tokenScore = tokens.reduce(
        (score, token) =>
            text.includes(token) ? score + 1 : score,
        0,
    );
    const logoScore =
        /logo|brand|mark|icon|emblem|badge|svg|校徽|徽标|标志|图标/u.test(text)
            ? 2
            : 0;
    const imageScore = looksLikeImageUrl(new URL(candidate.url))
        ? 1
        : 0;

    return tokenScore + logoScore + imageScore;
}

export class WebImageAssetProvider
    implements ImageAssetProvider
{
    constructor(
        private readonly options: WebImageAssetProviderOptions = {},
    ) {}

    async getImage(
        request: ImageAssetRequest,
        signal?: AbortSignal,
    ): Promise<ImageAssetResult> {
        signal?.throwIfAborted();
        if (request.mode !== "search") {
            throw new Error(
                "WebImageAssetProvider only supports search mode",
            );
        }

        const url = extractFirstUrl(request.query);
        validateUrl(url, this.options.allowedHosts);

        if (looksLikeImageUrl(url)) {
            return this.downloadImage(url, url.toString(), signal);
        }

        const html = await this.downloadText(
            url,
            this.options.maxHtmlBytes ?? DEFAULT_MAX_HTML_BYTES,
            signal,
        );
        const candidates = extractImageCandidates(html, url)
            .filter((candidate) => {
                const candidateUrl = new URL(candidate.url);

                try {
                    validateUrl(
                        candidateUrl,
                        this.options.allowedHosts,
                    );
                    return true;
                } catch {
                    return false;
                }
            })
            .sort(
                (left, right) =>
                    scoreCandidate(right, request) -
                    scoreCandidate(left, request),
            );

        const candidate = candidates[0];

        if (!candidate) {
            throw new Error(
                `No image candidates found on ${url.toString()}`,
            );
        }

        return this.downloadImage(
            new URL(candidate.url),
            url.toString(),
            signal,
        );
    }

    private async fetchWithTimeout(
        url: URL,
        signal?: AbortSignal,
    ): Promise<Response> {
        signal?.throwIfAborted();
        const timeoutMs =
            this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        const controller = new AbortController();
        let timedOut = false;
        const abortFromRequest = () => controller.abort(signal?.reason);
        signal?.addEventListener("abort", abortFromRequest, { once: true });
        if (signal?.aborted) {
            abortFromRequest();
        }
        const timeout = setTimeout(
            () => {
                timedOut = true;
                controller.abort();
            },
            timeoutMs,
        );

        try {
            return await fetch(url, {
                headers: {
                    "User-Agent":
                        "AppForgeAgentPlatform/0.1 image-fetch",
                },
                signal: controller.signal,
            });
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
                    `Web image request timed out after ${timeoutMs}ms`,
                );
            }

            throw error;
        } finally {
            clearTimeout(timeout);
            signal?.removeEventListener("abort", abortFromRequest);
        }
    }

    private async downloadText(
        url: URL,
        maxBytes: number,
        signal?: AbortSignal,
    ): Promise<string> {
        const response = await this.fetchWithTimeout(url, signal);

        if (!response.ok) {
            throw new Error(
                `Web page request failed with ${response.status}`,
            );
        }

        const contentLength = Number(
            response.headers.get("content-length") ?? 0,
        );

        if (contentLength > maxBytes) {
            throw new Error(
                `Web page exceeds maximum size of ${maxBytes} bytes`,
            );
        }

        const text = await response.text();

        if (new TextEncoder().encode(text).byteLength > maxBytes) {
            throw new Error(
                `Web page exceeds maximum size of ${maxBytes} bytes`,
            );
        }

        return text;
    }

    private async downloadImage(
        url: URL,
        pageUrl: string,
        signal?: AbortSignal,
    ): Promise<ImageAssetResult> {
        validateUrl(url, this.options.allowedHosts);

        const response = await this.fetchWithTimeout(url, signal);

        if (!response.ok) {
            throw new Error(
                `Image download failed with ${response.status}`,
            );
        }

        const maxBytes =
            this.options.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES;
        const contentLength = Number(
            response.headers.get("content-length") ?? 0,
        );

        if (contentLength > maxBytes) {
            throw new Error(
                `Image exceeds maximum size of ${maxBytes} bytes`,
            );
        }

        const data = new Uint8Array(
            await response.arrayBuffer(),
        );

        if (data.byteLength > maxBytes) {
            throw new Error(
                `Image exceeds maximum size of ${maxBytes} bytes`,
            );
        }

        return {
            data,
            mediaType: detectImageMediaType(data),
            source: `web:${url.toString()}`,
            attribution: `Found on ${pageUrl}`,
        };
    }
}
