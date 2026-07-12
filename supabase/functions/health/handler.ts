export function handleHealth(_request: Request): Response {
  return Response.json({
    status: "ok",
    service: "telegram-academy",
  });
}
