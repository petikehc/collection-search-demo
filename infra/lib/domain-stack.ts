import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib';
import { DomainName, EndpointType, SecurityPolicy } from 'aws-cdk-lib/aws-apigatewayv2';
import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager';
import type { Construct } from 'constructs';

export interface DomainStackProps extends StackProps {
  /** The web front end's hostname, e.g. collection-search.example.org. */
  domain: string;
}

/**
 * The web front end's custom domain: an HTTPS certificate and an API Gateway domain name.
 * Kept by `pnpm teardown` (like the Ci stack) and free to keep, so the two DNS records made by
 * hand stay valid and the site's address survives a teardown and rebuild.
 *
 * DNS is hosted outside AWS, so both records are added by hand:
 *   1. the certificate's validation CNAME (`aws acm describe-certificate`): the first deploy
 *      waits until it exists and ACM has issued the certificate;
 *   2. the site's CNAME, pointing at the RegionalDomainName output.
 */
export class DomainStack extends Stack {
  readonly domainName: DomainName;

  constructor(scope: Construct, id: string, props: DomainStackProps) {
    super(scope, id, { description: 'Collection search: web front end domain', ...props });

    // Regional, in this region: API Gateway regional domains need a certificate from the same
    // region (only CloudFront needs one from us-east-1).
    const certificate = new Certificate(this, 'Certificate', {
      domainName: props.domain,
      validation: CertificateValidation.fromDns(),
    });

    this.domainName = new DomainName(this, 'DomainName', {
      domainName: props.domain,
      certificate,
      endpointType: EndpointType.REGIONAL,
      securityPolicy: SecurityPolicy.TLS_1_2,
    });

    new CfnOutput(this, 'CertificateArn', { value: certificate.certificateArn });
    new CfnOutput(this, 'RegionalDomainName', {
      description: `Point a CNAME for ${props.domain} at this`,
      value: this.domainName.regionalDomainName,
    });
  }
}
