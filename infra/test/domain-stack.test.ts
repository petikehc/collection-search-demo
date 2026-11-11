import { readFileSync } from 'node:fs';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { DomainStack } from '../lib/domain-stack.js';

const { context } = JSON.parse(readFileSync(new URL('../cdk.json', import.meta.url), 'utf8'));
const env = { account: '111111111111', region: 'ap-southeast-2' };

describe('DomainStack', () => {
  const template = Template.fromStack(
    new DomainStack(new App({ context }), 'Domain', { env, domain: 'demo.example.org' }),
  );

  it('requests a certificate validated by a DNS record made by hand (no hosted zone)', () => {
    template.hasResourceProperties('AWS::CertificateManager::Certificate', {
      DomainName: 'demo.example.org',
      ValidationMethod: 'DNS',
    });
    const [cert] = Object.values(template.findResources('AWS::CertificateManager::Certificate'));
    expect(cert?.Properties.DomainValidationOptions).toBeUndefined();
  });

  it('is a regional API Gateway domain in this region, TLS 1.2 or later', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::DomainName', {
      DomainName: 'demo.example.org',
      DomainNameConfigurations: [
        {
          CertificateArn: { Ref: Match.anyValue() },
          EndpointType: 'REGIONAL',
          SecurityPolicy: 'TLS_1_2',
        },
      ],
    });
  });

  it('outputs the name the site CNAME points at', () => {
    template.hasOutput('RegionalDomainName', {});
  });
});
