from pathlib import Path

path = Path('tests/live-incident.test.ts')
text = path.read_text()
anchor = '''  async createIncident(): Promise<NilesIncidentRecord> {
'''
method = '''  async readChoiceValues(input: {
    field: 'pendingReason' | 'relationshipType' | 'impactScope';
  }) {
    this.operations.push(`GET choices ${input.field}`);
    const values =
      input.field === 'pendingReason'
        ? ['pending_external_dependency']
        : input.field === 'relationshipType'
          ? ['affected_by']
          : ['service_impacting'];
    return {
      values,
      transport: {
        method: 'GET' as const,
        pathTemplate: '/grc/itsm/choices?table=:table&field=:field',
        httpStatus: 200,
        durationMs: 1,
        correlationId: `choice_${input.field}`,
      },
    };
  }

'''
if text.count(anchor) != 1:
    raise RuntimeError(f'expected one createIncident anchor, found {text.count(anchor)}')
path.write_text(text.replace(anchor, method + anchor, 1))
