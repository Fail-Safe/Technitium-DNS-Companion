import {
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";

interface ApiEnvelope<T> {
  status?: string;
  response?: T;
  errorMessage?: string;
  innerErrorMessage?: string;
}

export function unwrapApiResponse<T>(
  envelope: ApiEnvelope<T> | undefined,
  nodeId: string,
  context: string,
): T;
export function unwrapApiResponse<T>(
  envelope: ApiEnvelope<T> | undefined,
  nodeId: string,
  context: string,
  allowEmptyResponse: true,
): T | undefined;
export function unwrapApiResponse<T>(
  envelope: ApiEnvelope<T> | undefined,
  nodeId: string,
  context: string,
  allowEmptyResponse = false,
): T | undefined {
  if (!envelope) {
    throw new ServiceUnavailableException(
      `Technitium DNS node "${nodeId}" returned no data while fetching ${context}.`,
    );
  }
  if (envelope.status !== "ok") {
    if (envelope.status === "invalid-token") {
      throw new UnauthorizedException(
        `Technitium DNS node "${nodeId}" rejected ${context}: invalid token.`,
      );
    }
    const detail =
      envelope.errorMessage ?? envelope.innerErrorMessage ?? "unknown error";
    throw new ServiceUnavailableException(
      `Technitium DNS node "${nodeId}" rejected ${context}: ${detail}.`,
    );
  }
  if (envelope.response === undefined && !allowEmptyResponse) {
    throw new ServiceUnavailableException(
      `Technitium DNS node "${nodeId}" did not include a response payload for ${context}.`,
    );
  }
  return envelope.response;
}
