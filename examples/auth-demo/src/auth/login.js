export function loginRedirect(next = "/dashboard") {
  return next.startsWith("/") ? next : "/dashboard";
}
