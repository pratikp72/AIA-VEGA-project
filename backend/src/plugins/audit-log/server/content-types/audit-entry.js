module.exports = {
  kind: 'collectionType',
  collectionName: 'audit_entries',
  info: {
    singularName: 'audit-entry',
    pluralName: 'audit-entries',
    displayName: 'Audit Entry',
    description: 'Track all changes made to content entries',
  },
  options: {
    draftAndPublish: false,
    comment: 'System collection - do not modify manually',
  },
  pluginOptions: {},
  attributes: {
    action: {
      type: 'enumeration',
      enum: ['created', 'updated', 'deleted'],
      required: true,
    },
    contentType: {
      type: 'string',
      required: true,
    },
    collectionName: {
      type: 'string',
    },
    entryId: {
      type: 'integer',
      required: true,
    },
    adminUser: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'admin::user',
    },
    changes: {
      type: 'json',
      description: 'Array of changed fields with old and new values',
    },
    snapshot: {
      type: 'json',
      description: 'Full data snapshot at time of change',
    },
    company: {
      type: 'string',
      configurable: false,
      description: 'Company (AIA or Vega) for filtering',
    },
  },
};
