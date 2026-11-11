/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    /** Set by the middleware when the request carries a valid access token for the web client. */
    user?: {
      sub: string;
      email?: string;
      scopes: string[];
      accessToken: string;
    };
  }
}
