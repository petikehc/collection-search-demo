import { Architecture, LoggingFormat, Runtime } from 'aws-cdk-lib/aws-lambda';
import type { NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';

/**
 * Shared settings for every Node.js Lambda in the app.
 *
 * Bundling includes the AWS SDK and its @smithy packages (`externalModules: []`) rather than
 * relying on the copy in the Lambda runtime: the function runs the exact versions in our
 * lockfile, and libraries that import @smithy packages directly (e.g. aws-xray-sdk-core, used
 * by Powertools Tracer) can't fail at load time with "Cannot find module".
 */
export const LAMBDA_DEFAULTS = {
  runtime: Runtime.NODEJS_24_X,
  architecture: Architecture.ARM_64,
  loggingFormat: LoggingFormat.JSON,
  bundling: {
    externalModules: [],
    minify: true,
    sourceMap: true,
  },
  environment: { NODE_OPTIONS: '--enable-source-maps' },
} satisfies Partial<NodejsFunctionProps>;
