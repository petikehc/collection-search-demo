import { Stack, type StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

/** OpenSearch domain, its bootstrap custom resource and the ingest Lambda (added in later steps). */
export class SearchStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, { description: 'Collection search: OpenSearch domain and ingest', ...props });
  }
}
