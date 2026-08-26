PRAGMA foreign_keys=OFF;
PRAGMA user_version=5;
BEGIN TRANSACTION;
CREATE TABLE entries (
    seq INTEGER PRIMARY KEY,
    at_ms INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('campaign', 'candidate', 'verdict', 'call', 'tool-call', 'call-result', 'tool-result')),
    body TEXT NOT NULL CHECK(json_valid(body) AND json_type(body) = 'object'),
    material BLOB CHECK((kind = 'candidate') = (material IS NOT NULL))
  ) STRICT;
INSERT INTO entries VALUES(1,1787673771502,'campaign','{"application":"elenx-solve","config":{"protocol":"exploration-v12","problem":"Determine all integers n such that n^2+3n+2 is prime.","completionCriteria":"State the exact set of integers and prove both inclusions.","memory":"both","maxExplorerContextTokens":200000,"guidance":{"explorer":[{"origin":"default","text":"Guidance is strategy advice, not mathematical evidence, and cannot change the goal, completion criteria, or audit requirements."},{"origin":"default","text":"An index beginning with Assuming is conditional; its premise remains open."}],"coordinator":[{"origin":"default","text":"Guidance is strategy advice, not mathematical evidence, and cannot change the goal, completion criteria, or audit requirements."},{"origin":"default","text":"Preserve a useful implication blocked only by an open premise as an explicit index beginning with Assuming. When later evidence proves or refutes that premise, revise or drop the conditional and its dependents."}]},"coordinator":{"provider":"coordinator","model":"coordinator-v1","reasoning":"max","api":"openai-responses","baseUrl":"https://invalid.test/v1"},"explorer":{"provider":"explorer","model":"explorer-v1","reasoning":"max","api":"openai-responses","baseUrl":"https://invalid.test/v1"},"evidenceAuditors":[{"provider":"reviewer","model":"reviewer-v1","reasoning":"high","name":"scope","api":"openai-responses","baseUrl":"https://invalid.test/v1"}],"resolutionAuditors":[{"provider":"openai-codex","model":"verifier-v2","reasoning":"max","kind":"premise-audit","api":"openai-responses","baseUrl":"https://invalid.test/v1"},{"provider":"verifier","model":"verifier-v1","reasoning":"max","kind":"proof-audit","api":"openai-responses","baseUrl":"https://invalid.test/v1"},{"provider":"reconstructor","model":"reconstructor-v1","reasoning":"max","kind":"reconstruction","api":"openai-responses","baseUrl":"https://invalid.test/v1"}]}}',NULL);
CREATE TRIGGER entries_no_update BEFORE UPDATE ON entries BEGIN SELECT RAISE(ABORT, 'entries are append-only'); END;
CREATE TRIGGER entries_no_delete BEFORE DELETE ON entries BEGIN SELECT RAISE(ABORT, 'entries are append-only'); END;
CREATE UNIQUE INDEX one_campaign ON entries(kind) WHERE kind = 'campaign';
CREATE UNIQUE INDEX one_result ON entries(json_extract(body, '$.parent')) WHERE kind IN ('call-result', 'tool-result');
CREATE UNIQUE INDEX one_verdict_call ON entries(json_extract(body, '$.call')) WHERE kind = 'verdict';
COMMIT;
