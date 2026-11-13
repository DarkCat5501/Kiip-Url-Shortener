const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  404: 'Not Found',
  409: 'Conflict',
  410: 'Gone',
  422: 'Unprocessable Entity',
  500: 'Internal Server Error',
};

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string | string[],
  ) {
    super(Array.isArray(message) ? message.join('; ') : message);
    this.body = { message, error: STATUS_TEXT[status], statusCode: status };
  }

  readonly body: { message: string | string[]; error: string; statusCode: number };
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, 'Bad Request');
  }
}
