# Evidence and replay

Screenshots and PDFs have a 16 MiB ceiling. Captured evidence must record ID,
content type, byte size, and SHA-256. Hosted persistence uses bounded chunks
and is successful only after commit; standalone persistence returns a private
plugin-data path with equivalent metadata.

Hosted uploads use a Host staging reference; standalone uploads stay below the
configured upload root. Replay records include only safe steps and artifact
identifiers, never authentication or unrestricted local paths.
