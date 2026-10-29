CREATE TABLE knowledge_events (
 id text PRIMARY KEY NOT NULL,
 document_id text NOT NULL REFERENCES documents(document_id),
 revision_id text NOT NULL REFERENCES revisions(id),
 kind text NOT NULL CHECK(kind IN ('evidence','observation','issue','proposal','review','resolution','contribution','applied')),
 subject_id text REFERENCES knowledge_events(id),
 source_key text,
 source_version text,
 payload text NOT NULL CHECK(json_valid(payload)),
 work_context text NOT NULL CHECK(json_valid(work_context)),
 principal text NOT NULL CHECK(json_valid(principal)),
 created_at text NOT NULL
);
--> statement-breakpoint
CREATE INDEX knowledge_document_revision ON knowledge_events(document_id,revision_id,created_at,id);
--> statement-breakpoint
CREATE INDEX knowledge_source ON knowledge_events(source_key,source_version);
--> statement-breakpoint
CREATE UNIQUE INDEX knowledge_closed_subject ON knowledge_events(subject_id) WHERE kind IN ('resolution','applied');
--> statement-breakpoint
CREATE UNIQUE INDEX knowledge_source_candidate ON knowledge_events(subject_id,source_version) WHERE kind='issue' AND source_key IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER knowledge_insert_guard BEFORE INSERT ON knowledge_events BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM identity_gate g JOIN identity_meta m ON m.id=g.id WHERE (g.mode='write' AND m.state='active') OR (g.mode='maintenance' AND m.state IN ('frozen','migrating','verified','maintenance'))) THEN RAISE(ABORT,'knowledge write requires identity gate') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM revisions r WHERE r.id=NEW.revision_id AND r.document_id=NEW.document_id) THEN RAISE(ABORT,'knowledge revision ownership mismatch') END;
 SELECT CASE WHEN NEW.subject_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM knowledge_events e WHERE e.id=NEW.subject_id AND e.document_id=NEW.document_id) THEN RAISE(ABORT,'knowledge subject ownership mismatch') END;
 SELECT CASE WHEN NEW.kind='contribution' AND json_extract(NEW.payload,'$.target')='comment' AND NOT EXISTS(SELECT 1 FROM comments c JOIN threads t ON t.id=c.thread_id WHERE c.id=json_extract(NEW.payload,'$.target_id') AND t.document_id=NEW.document_id) THEN RAISE(ABORT,'knowledge comment ownership mismatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER knowledge_immutable_update BEFORE UPDATE ON knowledge_events BEGIN SELECT RAISE(ABORT,'knowledge records are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER knowledge_immutable_delete BEFORE DELETE ON knowledge_events BEGIN SELECT RAISE(ABORT,'knowledge records are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER knowledge_epoch AFTER INSERT ON knowledge_events BEGIN UPDATE wiki_state SET version=version+1 WHERE id=1; END;
