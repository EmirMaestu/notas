import { OAUTH_SCOPE } from '@/core/oauth';
import { appUrl, mcpResourceUrl } from './app-url';

/** Protected Resource Metadata del MCP (RFC 9728). */
export function protectedResourceMetadata() {
  return {
    resource: mcpResourceUrl(),
    authorization_servers: [appUrl()],
    scopes_supported: [OAUTH_SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'Notas',
  };
}

/**
 * Authorization Server Metadata (RFC 8414). Solo clientes públicos con PKCE S256 y registro dinámico;
 * `iss` en las respuestas de autorización (RFC 9207), que ChatGPT usa para elegir su redirect fijo.
 */
export function authorizationServerMetadata() {
  const base = appUrl();
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [OAUTH_SCOPE],
    authorization_response_iss_parameter_supported: true,
  };
}
