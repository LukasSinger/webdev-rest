import * as path from "node:path";
import * as url from "node:url";

import { default as express } from "express";
import { default as sqlite3 } from "sqlite3";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const db_filename = path.join(__dirname, "db", "stpaul_crime.sqlite3");

const port = 8000;

let app = express();
app.use(express.json());

/********************************************************************
 ***   DATABASE FUNCTIONS                                         ***
 ********************************************************************/
// Open SQLite3 database (in read-write mode)
let db = new sqlite3.Database(db_filename, sqlite3.OPEN_READWRITE, (err) => {
    if (err) {
        console.log("Error opening " + db_filename);
    } else {
        console.log("Now connected to " + path.basename(db_filename));
    }
});

// Create Promise for SQLite3 database SELECT query
function dbSelect(query, params) {
    return new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
}

// Create Promise for SQLite3 database INSERT or DELETE query
function dbRun(query, params) {
    return new Promise((resolve, reject) => {
        db.run(query, params, (err) => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
}
function formatTime(dateStr) {
    const date = new Date(dateStr);
    const hours = date.getHours().toString().padStart(2, "0");
    const minutes = date.getMinutes().toString().padStart(2, "0");
    const seconds = date.getSeconds().toString().padStart(2, "0");

    return `${hours}:${minutes}:${seconds}`;
}
function formatDate(dateStr) {
    const date = new Date(dateStr);
    const year = date.getFullYear().toString();
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const day = date.getDate().toString().padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function prettyPrintCompact(obj) {
    let result = JSON.stringify(obj, null, 2);
    result = result.replaceAll("{\n    ", "{");
    result = result.replaceAll("\n  }", "}");
    result = result.replaceAll(",\n    ", ", ");
    return result;
}

/**
 * Enforces valid form of incoming data to PUT /new-incident.
 * @param {object} data The data to sanitize.
 * @returns An object that complies with the available columns and their data types, or null if data is invalid.
 */
function sanitizeNewIncident(data) {
    // Format/validate date and time
    const dateStr = String(data["date"]) + " " + String(data["time"]);
    if (Number.isNaN(new Date(dateStr).valueOf())) return null;
    const dateTime = formatDate(dateStr) + " " + formatTime(dateStr);
    // Validate code
    const code = Number(data["code"]);
    if (!isInteger(code)) return null;
    // Validate police_grid
    const policeGrid = Number(data["police_grid"]);
    if (!isInteger(policeGrid)) return null;
    // Validate neighborhood_number
    const neighborhoodNumber = Number(data["neighborhood_number"]);
    if (!isInteger(neighborhoodNumber)) return null;

    return {
        case_number: String(data["case_number"]),
        date_time: dateTime,
        code: code,
        incident: String(data["incident"]),
        police_grid: policeGrid,
        neighborhood_number: neighborhoodNumber,
        block: String(data["block"])
    };
}

/**
 * Returns whether the number is an integer.
 * @param {number} number The number to check.
 */
function isInteger(number) {
    return Number.isNaN(number) || Math.round(number) === number;
}

/********************************************************************
 ***   REST REQUEST HANDLERS                                      ***
 ********************************************************************/
// GET request handler for crime codes
app.get("/codes", async (req, res) => {
    let codes = req.query["code"];
    if (codes) codes = codes.split(",");
    let data;
    try {
        data = await dbSelect("SELECT * FROM Codes ORDER BY code");
    } catch (err) {
        console.error(err);
        res.status(500).type("text/html").send("500 Internal Server Error");
        return;
    }
    const resData = [];
    for (const entry of data) {
        if (!codes || codes.includes(entry["code"].toString())) {
            resData.push({
                code: entry["code"],
                type: entry["incident_type"]
            });
        }
    }
    res.status(200).type("json").send(prettyPrintCompact(resData));
});

// GET request handler for neighborhoods
app.get("/neighborhoods", async (req, res) => {
    let ids = req.query["id"];
    if (ids) ids = ids.split(",");
    let data;
    try {
        data = await dbSelect("SELECT * FROM Neighborhoods ORDER BY neighborhood_number");
    } catch (err) {
        console.error(err);
        res.status(500).type("text/html").send("500 Internal Server Error");
        return;
    }
    const resData = [];
    for (const entry of data) {
        if (!ids || ids.includes(entry["neighborhood_number"].toString())) {
            resData.push({
                id: entry["neighborhood_number"],
                name: entry["neighborhood_name"]
            });
        }
    }
    res.status(200).type("json").send(prettyPrintCompact(resData));
});

// GET request handler for crime incidents
app.get("/incidents", (req, res) => {
    console.log(req.query);
    let whereParts = [];
    let params = [];
    let query = "SELECT * FROM Incidents";
    let limit = 1000;
    if ("start_date" in req.query) {
        whereParts.push("DATE(date_time) >= DATE(?)");
        params.push(req.query["start_date"]);
    }
    if ("end_date" in req.query) {
        whereParts.push("DATE(date_time) <= DATE(?)");
        params.push(req.query["end_date"]);
    }
    if ("code" in req.query) {
        let safe_codes = req.query["code"]
            .split(",")
            .map((c) => parseInt(c))
            .join(", ");
        whereParts.push(`code in (${safe_codes})`);
    }
    if ("grid" in req.query) {
        let safe_grid = req.query["grid"]
            .split(",")
            .map((g) => parseInt(g))
            .join(", ");
        whereParts.push(`police_grid in (${safe_grid})`);
    }
    if ("neighborhood" in req.query) {
        let safe_neighborhood = req.query["neighborhood"]
            .split(",")
            .map((n) => parseInt(n))
            .join(", ");
        whereParts.push(`neighborhood_number in (${safe_neighborhood})`);
    }
    if ("limit" in req.query) {
        limit = req.query["limit"];
    }
    if (whereParts.length > 0) {
        query += " WHERE " + whereParts.join(" AND ");
    }
    query += " ORDER BY date_time";
    query += " LIMIT ?";
    params.push(limit);
    console.log(query, params);
    dbSelect(query, params)
        .then((rows) => {
            let response = [];
            for (let row of rows) {
                response.push({
                    case_number: row["case_number"],
                    date: formatDate(row["date_time"]),
                    time: formatTime(row["date_time"]),
                    code: row["code"],
                    incident: row["incident"],
                    police_grid: row["police_grid"],
                    neighborhood_number: row["neighborhood_number"],
                    block: row["block"]
                });
            }
            res.status(200).type("json").send(JSON.stringify(response, null, 2));
        })
        .catch((err) => {
            console.log(err);
            res.status(400).type("txt").send("Invalid request");
        });
});

// PUT request handler for new crime incident
app.put("/new-incident", async (req, res) => {
    // Enforce data structure
    const data = sanitizeNewIncident(req.body);
    if (!data) {
        res.status(400).type("text/html").send("400 Bad Request");
        return;
    }
    // Check for case number collision
    let collisionValues;
    try {
        collisionValues = await dbSelect("SELECT case_number FROM Incidents WHERE case_number = ?", [data["case_number"]]);
    } catch (err) {
        console.log(err);
        res.status(500).type;
        return;
    }
    if (collisionValues.length > 0) {
        // This situation is conventionally status 4xx, but API spec requires 500
        res.status(500).type("text/html").send("Could not add incident: case number already exists");
        return;
    }
    // Insert the new entry
    let dbQuery = "INSERT INTO Incidents (case_number, date_time, code, incident, police_grid, neighborhood_number, block) VALUES (";
    dbQuery += "?,".repeat(Object.keys(data).length - 1);
    dbQuery += "?)";
    try {
        await dbRun(dbQuery, Object.values(data));
    } catch (err) {
        console.error(err);
        res.status(500).type("text/html").send("500 Internal Server Error");
        return;
    }
    res.status(200).type("txt").send("OK");
});

// DELETE request handler for new crime incident
app.delete("/remove-incident", async (req, res) => {
    console.log(req.body); // uploaded data
    const number = req.body["case_number"];
    dbSelect("select * from Incidents where case_number=?", [number])
        .then((rows) => {
            if (rows.length == 0) {
                throw "Invalid case number";
            }
            return dbRun("delete from Incidents where case_number=?", [number]);
        })
        .then(() => {
            res.status(200).type("txt").send("OK");
        })
        .catch((err) => {
            res.status(500).type("txt").send(err);
        });
});

/********************************************************************
 ***   START SERVER                                               ***
 ********************************************************************/
// Start server - listen for client connections
app.listen(port, () => {
    console.log("Now listening on port " + port);
});
