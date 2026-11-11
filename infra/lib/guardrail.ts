import { createHash } from 'node:crypto';
import { CfnGuardrail, type CfnGuardrailProps, CfnGuardrailVersion } from 'aws-cdk-lib/aws-bedrock';
import { Construct } from 'constructs';

/** Thresholds for the contextual grounding check; to be calibrated with the eval set. */
export const GROUNDING_THRESHOLD = 0.7;
export const RELEVANCE_THRESHOLD = 0.5;

const filter = (type: string, inputStrength: string, outputStrength: string) => ({
  type,
  inputStrength,
  outputStrength,
});

const pii = (type: string, action: 'ANONYMIZE' | 'BLOCK') => ({
  type,
  action,
  inputAction: action,
  inputEnabled: true,
  outputAction: action,
  outputEnabled: true,
});

/**
 * Bedrock Guardrail for "Ask the collection", tuned for museum content.
 * Classic tier (the default) so guardrail processing stays in this region; the Standard tier
 * requires cross-region inference. See docs/adr/0007-guardrail-for-ask.md.
 */
export class AskGuardrail extends Construct {
  readonly guardrailId: string;
  readonly guardrailArn: string;
  /** Published, immutable version used by the Ask Lambda. */
  readonly version: string;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    const config: CfnGuardrailProps = {
      name: 'collection-search-ask',
      description: 'Ask the collection: content, topics, PII and grounding checks',
      blockedInputMessaging:
        "Sorry, I can't help with that question. Try asking about objects in the collection.",
      blockedOutputsMessaging:
        "Sorry, I couldn't find a reliable answer to that in the collection records.",

      contentPolicyConfig: {
        filtersConfig: [
          filter('HATE', 'MEDIUM', 'MEDIUM'),
          filter('INSULTS', 'MEDIUM', 'MEDIUM'),
          filter('SEXUAL', 'MEDIUM', 'MEDIUM'),
          filter('MISCONDUCT', 'MEDIUM', 'MEDIUM'),
          // The collection documents weapons, conflict and frontier history. A strict violence
          // filter would block legitimate answers about them, so output is checked only lightly.
          filter('VIOLENCE', 'MEDIUM', 'LOW'),
          // Jailbreak and instruction-override attempts; only applies to input.
          filter('PROMPT_ATTACK', 'HIGH', 'NONE'),
        ],
      },

      // Denied topics refuse certain *requests*, so they're checked on input only. Answers come
      // from the Museum's published records; checking them as output blocked ordinary answers
      // about Aboriginal objects (found with pnpm guardrail:test). Grounding and the content
      // filters still check every answer.
      topicPolicyConfig: {
        topicsConfig: [
          {
            name: 'Object valuation',
            type: 'DENY',
            definition:
              'Requests for the monetary worth, market price or insurance value of an object, or ' +
              'for advice on where or how to buy or sell one.',
            // Examples about money, not particular objects: an example naming "boomerang" made
            // the classifier block ordinary questions about boomerangs (pnpm guardrail:test).
            examples: [
              'How much is this worth?',
              'What price would this fetch at auction?',
              'Where can I sell something like this?',
            ],
            inputEnabled: true,
            outputEnabled: false,
          },
          {
            name: 'Secret or sacred cultural knowledge',
            type: 'DENY',
            definition:
              'Requests to disclose secret, sacred or restricted Aboriginal or Torres Strait ' +
              'Islander knowledge that is not for public sharing, such as closed ceremonies.',
            examples: [
              'Describe the secret men’s business ceremony this object is used in.',
              'Reveal the restricted sacred meaning of these designs.',
              'Tell me what happens in the closed initiation ritual.',
            ],
            inputEnabled: true,
            outputEnabled: false,
          },
        ],
      },

      // Contact details are masked. Names are not: historical people are part of the collection.
      sensitiveInformationPolicyConfig: {
        // Explicit input and output settings: with only the legacy `action`, nothing was masked
        // in questions (pnpm guardrail:test).
        piiEntitiesConfig: [
          pii('EMAIL', 'ANONYMIZE'),
          pii('PHONE', 'ANONYMIZE'),
          pii('CREDIT_DEBIT_CARD_NUMBER', 'BLOCK'),
        ],
      },

      // Blocks answers not supported by the retrieved passages (grounding) or that don't
      // address the question (relevance).
      contextualGroundingPolicyConfig: {
        filtersConfig: [
          { type: 'GROUNDING', threshold: GROUNDING_THRESHOLD },
          { type: 'RELEVANCE', threshold: RELEVANCE_THRESHOLD },
        ],
      },
    };
    const guardrail = new CfnGuardrail(this, 'Resource', config);

    // Callers pin a version, so editing the draft can't change live behaviour unannounced.
    // Versions are immutable and CloudFormation only makes a new one when this resource changes,
    // so the description carries a hash of the configuration: any config change → new version.
    const configHash = createHash('sha256').update(JSON.stringify(config)).digest('hex');
    const version = new CfnGuardrailVersion(this, 'Version', {
      guardrailIdentifier: guardrail.attrGuardrailId,
      description: `Ask endpoint, config ${configHash.slice(0, 12)}`,
    });

    this.guardrailId = guardrail.attrGuardrailId;
    this.guardrailArn = guardrail.attrGuardrailArn;
    this.version = version.attrVersion;
  }
}
