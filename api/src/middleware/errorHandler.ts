/**
 * Error Handler Middleware
 *
 * Global error handling for the API
 * Catches all errors and formats them as JSON responses
 */

import { Context, Next, MiddlewareHandler } from 'hono';
import { ZodError } from 'zod';
import { logger } from '@/utils/logger';

/**
 * Error response format
 */
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// L-7 SECURITY FIX: Only show verbose errors in development and test,
// never in staging or production
function isVerboseErrors(): boolean {
  const env = process.env.NODE_ENV;
  return env === 'development' || env === 'test';
}

/**
 * Global error handler middleware
 *
 * Catches errors from route handlers and formats them consistently
 */
export const errorHandler: MiddlewareHandler = async (c: Context, next: Next) => {
  try {
    return await next();
  } catch (error) {
    logger.error('Unhandled error', {
      error: String(error),
      stack: error instanceof Error ? error.stack : undefined,
      cause: error instanceof Error && error.cause ? String(error.cause) : undefined,
      path: c.req.path,
      method: c.req.method,
    });

    // Handle Zod validation errors
    if (error instanceof ZodError) {
      return c.json<ErrorResponse>(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data',
            details: error.issues,
          },
        },
        400
      );
    }

    // Handle known error types
    if (error instanceof Error) {
      // Check for specific error messages
      if (error.message.includes('UNAUTHENTICATED')) {
        return c.json<ErrorResponse>(
          {
            error: {
              code: 'UNAUTHENTICATED',
              message: 'Authentication required',
            },
          },
          401
        );
      }

      if (error.message.includes('FORBIDDEN') || error.message.includes('CONSENT')) {
        return c.json<ErrorResponse>(
          {
            error: {
              code: 'FORBIDDEN',
              message: isVerboseErrors()
                ? error.message
                : 'Access denied',
            },
          },
          403
        );
      }

      if (error.message.includes('NOT_FOUND') || error.message.includes('not found')) {
        return c.json<ErrorResponse>(
          {
            error: {
              code: 'NOT_FOUND',
              message: isVerboseErrors()
                ? error.message
                : 'Resource not found',
            },
          },
          404
        );
      }

      if (error.message.includes('SQL_SANDBOX_ERROR') || error.message.includes('Only SELECT queries allowed')) {
        return c.json<ErrorResponse>(
          {
            error: {
              code: 'BAD_REQUEST',
              message: isVerboseErrors()
                ? error.message
                : 'Query validation failed',
            },
          },
          400
        );
      }

      // Default error response
      return c.json<ErrorResponse>(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: isVerboseErrors()
              ? error.message
              : 'An internal error occurred',
          },
        },
        500
      );
    }

    // Unknown error type
    return c.json<ErrorResponse>(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      },
      500
    );
  }
};
