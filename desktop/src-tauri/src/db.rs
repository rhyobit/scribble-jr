//! SQLite layer mirroring the iOS native `Database.m` contract exactly:
//!
//! * every bound value is TEXT (iOS uses `sqlite3_bind_text` for all values),
//! * `stmt` returns `last_insert_rowid` as a decimal string,
//! * `query` returns a JSON array of row objects whose values are the TEXT form of each
//!   column (`sqlite3_column_text`) with NULL columns omitted,
//! * any failure returns `"SQL error: <msg>"`.

use std::path::Path;

use rusqlite::types::{ToSqlOutput, Value as SqlValue, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde::Deserialize;
use serde_json::{Map, Value};

const CREATE_TABLES: [&str; 3] = [
    "CREATE TABLE IF NOT EXISTS PROJECTS (ID INTEGER PRIMARY KEY AUTOINCREMENT, CTIME DATETIME DEFAULT CURRENT_TIMESTAMP, MTIME DATETIME, ALTMD5 TEXT, POS INTEGER, NAME TEXT, JSON TEXT, THUMBNAIL TEXT, OWNER TEXT, GALLERY TEXT, DELETED TEXT, VERSION TEXT)",
    "CREATE TABLE IF NOT EXISTS USERSHAPES (ID INTEGER PRIMARY KEY AUTOINCREMENT, CTIME DATETIME DEFAULT CURRENT_TIMESTAMP, MD5 TEXT, ALTMD5 TEXT, WIDTH TEXT, HEIGHT TEXT, EXT TEXT, NAME TEXT, OWNER TEXT, SCALE TEXT, VERSION TEXT)",
    "CREATE TABLE IF NOT EXISTS USERBKGS (ID INTEGER PRIMARY KEY AUTOINCREMENT, CTIME DATETIME DEFAULT CURRENT_TIMESTAMP, MD5 TEXT, ALTMD5 TEXT, WIDTH TEXT, HEIGHT TEXT, EXT TEXT, OWNER TEXT,  VERSION TEXT)",
];

/// Migration from iOS `runMigrations`; fails silently when the column already exists.
const MIGRATION_ISGIFT: &str = "ALTER TABLE PROJECTS ADD COLUMN ISGIFT INTEGER DEFAULT 0";

/// Opens (creating if needed) the database file and runs table creation + migrations.
pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    init(&conn)?;
    Ok(conn)
}

/// In-memory database with the same schema (used by unit tests).
#[cfg(test)]
pub fn open_in_memory() -> rusqlite::Result<Connection> {
    let conn = Connection::open_in_memory()?;
    init(&conn)?;
    Ok(conn)
}

fn init(conn: &Connection) -> rusqlite::Result<()> {
    // The page can run arbitrary SQL (as on iOS). Disallow ATTACH so that SQL can
    // never create or write database files outside projects.db.
    conn.set_limit(rusqlite::limits::Limit::SQLITE_LIMIT_ATTACHED, 0);
    for sql in CREATE_TABLES {
        conn.execute_batch(sql)?;
    }
    let _ = conn.execute_batch(MIGRATION_ISGIFT);
    Ok(())
}

#[derive(Deserialize)]
struct Request {
    stmt: String,
    #[serde(default)]
    values: Vec<Value>,
}

/// A bound parameter: TEXT, or NULL for JSON null.
struct TextParam(Option<String>);

impl rusqlite::ToSql for TextParam {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(match &self.0 {
            Some(s) => ToSqlOutput::Borrowed(ValueRef::Text(s.as_bytes())),
            None => ToSqlOutput::Owned(SqlValue::Null),
        })
    }
}

fn to_text_param(v: &Value) -> TextParam {
    TextParam(match v {
        Value::Null => None,
        Value::String(s) => Some(s.clone()),
        // Numbers, booleans, arrays and objects are bound by their JSON text form.
        other => Some(other.to_string()),
    })
}

fn parse(json: &str) -> Result<(String, Vec<TextParam>), String> {
    let req: Request =
        serde_json::from_str(json).map_err(|e| format!("SQL error: bad request json: {e}"))?;
    let params = req.values.iter().map(to_text_param).collect();
    Ok((req.stmt, params))
}

fn sql_error(e: rusqlite::Error) -> String {
    match e {
        rusqlite::Error::SqliteFailure(_, Some(msg)) => format!("SQL error: {msg}"),
        other => format!("SQL error: {other}"),
    }
}

/// Executes a statement; returns last_insert_rowid or "SQL error: ...".
/// Like iOS, a statement that yields rows (e.g. a SELECT) is an error here.
pub fn stmt(conn: &Connection, json: &str) -> String {
    let (sql, params) = match parse(json) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let result = conn
        .prepare(&sql)
        .and_then(|mut s| s.execute(params_from_iter(params.iter())));
    match result {
        Ok(_) => conn.last_insert_rowid().to_string(),
        Err(e) => sql_error(e),
    }
}

/// Runs a query; returns a JSON array of row objects (TEXT values, NULLs omitted).
pub fn query(conn: &Connection, json: &str) -> String {
    let (sql, params) = match parse(json) {
        Ok(p) => p,
        Err(e) => return e,
    };
    match query_rows(conn, &sql, &params) {
        Ok(rows) => Value::Array(rows).to_string(),
        Err(e) => sql_error(e),
    }
}

/// Returns true when the query yields at least one row (used by clean_assets).
pub fn has_rows(conn: &Connection, sql: &str, value: &str) -> rusqlite::Result<bool> {
    let mut s = conn.prepare(sql)?;
    let mut rows = s.query([value])?;
    Ok(rows.next()?.is_some())
}

fn query_rows(
    conn: &Connection,
    sql: &str,
    params: &[TextParam],
) -> rusqlite::Result<Vec<Value>> {
    let mut s = conn.prepare(sql)?;
    let names: Vec<String> = s.column_names().iter().map(|n| n.to_string()).collect();
    let mut rows = s.query(params_from_iter(params.iter()))?;
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        let mut obj = Map::new();
        for (i, name) in names.iter().enumerate() {
            if let Some(text) = column_text(row.get_ref(i)?) {
                obj.insert(name.clone(), Value::String(text));
            }
        }
        out.push(Value::Object(obj));
    }
    Ok(out)
}

/// Equivalent of `sqlite3_column_text`: None for NULL, otherwise the text form.
fn column_text(v: ValueRef<'_>) -> Option<String> {
    match v {
        ValueRef::Null => None,
        ValueRef::Integer(i) => Some(i.to_string()),
        ValueRef::Real(f) => Some(real_to_text(f)),
        ValueRef::Text(t) | ValueRef::Blob(t) => Some(String::from_utf8_lossy(t).into_owned()),
    }
}

/// Approximates SQLite's REAL -> TEXT conversion ("%!.15g": 15 significant digits,
/// integral values keep a trailing ".0").
fn real_to_text(f: f64) -> String {
    if !f.is_finite() {
        return if f.is_nan() { String::new() } else if f > 0.0 { "Inf".into() } else { "-Inf".into() };
    }
    let rounded: f64 = format!("{f:.14e}").parse().unwrap_or(f);
    if rounded.fract() == 0.0 && rounded.abs() < 1e15 {
        format!("{rounded:.1}")
    } else {
        format!("{rounded}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stmt_returns_rowid_and_query_omits_nulls_and_stringifies() {
        let conn = open_in_memory().unwrap();
        let id = stmt(
            &conn,
            r#"{"stmt":"insert into projects (name, json, pos, version) values (?,?,?,?)","values":["P1","{}",3,null]}"#,
        );
        assert_eq!(id, "1");

        let res = query(&conn, r#"{"stmt":"select id, name, pos, version, isgift, mtime from projects where name = ?","values":["P1"]}"#);
        let rows: Value = serde_json::from_str(&res).unwrap();
        let row = rows[0].as_object().unwrap();
        assert_eq!(row["ID"], Value::String("1".into()));
        assert_eq!(row["NAME"], Value::String("P1".into()));
        // number bound as TEXT "3" -> INTEGER affinity -> returned as the string "3"
        assert_eq!(row["POS"], Value::String("3".into()));
        // default ISGIFT 0 from the migration
        assert_eq!(row["ISGIFT"], Value::String("0".into()));
        // NULL columns omitted
        assert!(!row.contains_key("VERSION"));
        assert!(!row.contains_key("MTIME"));
    }

    #[test]
    fn errors_are_prefixed() {
        let conn = open_in_memory().unwrap();
        let r = stmt(&conn, r#"{"stmt":"insert into nope values (?)","values":["x"]}"#);
        assert!(r.starts_with("SQL error: "), "{r}");
        let q = query(&conn, r#"{"stmt":"select * from nope","values":[]}"#);
        assert!(q.starts_with("SQL error: "), "{q}");
        assert!(stmt(&conn, "not json").starts_with("SQL error: "));
    }

    #[test]
    fn attach_is_disabled() {
        let conn = open_in_memory().unwrap();
        let r = stmt(&conn, r#"{"stmt":"ATTACH DATABASE 'x.db' AS x","values":[]}"#);
        assert!(r.starts_with("SQL error: "), "{r}");
        assert!(!std::path::Path::new("x.db").exists());
    }

    #[test]
    fn migration_is_idempotent() {
        let conn = open_in_memory().unwrap();
        init(&conn).unwrap();
    }

    #[test]
    fn real_text_form() {
        assert_eq!(real_to_text(1.5), "1.5");
        assert_eq!(real_to_text(2.0), "2.0");
        assert_eq!(real_to_text(0.1 + 0.2), "0.3");
    }
}
