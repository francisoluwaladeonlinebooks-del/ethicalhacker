/**
 * Route-parameter identifier validation.
 *
 * Every detail page takes its record id straight from the URL. Passing a
 * malformed value through to the database produces a driver-level cast error
 * (`22P02 invalid input syntax for type uuid`) which surfaces as a 500 rather
 * than the truthful "this record does not exist" 404. A non-UUID can never
 * identify a record, so it is rejected before any query runs: the user gets a
 * clean not-found page and the application logs no database error.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}
