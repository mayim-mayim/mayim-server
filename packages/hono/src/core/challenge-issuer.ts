import type { Fetcher } from '@cloudflare/workers-types';
import type {
    IssuedL402Challenge,
    L402ChallengeIssueInput,
    L402ChallengeIssuer
} from '@ln-church/server';

/** Adapter for an internal, operator-configured Lightning invoice service. */
export class ServiceBindingL402ChallengeIssuer implements L402ChallengeIssuer {
    constructor(private readonly service: Fetcher) {}

    async issue(input: L402ChallengeIssueInput): Promise<IssuedL402Challenge | null> {
        const response = await this.service.fetch("https://l402-issuer.internal/issue", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(input)
        });
        if (response.status === 404 || response.status === 503) return null;
        if (!response.ok) throw new Error(`L402 issuer failed closed with status ${response.status}.`);
        return response.json() as Promise<IssuedL402Challenge>;
    }
}
