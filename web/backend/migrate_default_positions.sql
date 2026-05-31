-- Seed default positions for all workspaces that currently have none.
INSERT INTO workspace_positions (workspace_id, name_ru, name_uz)
SELECT w.id, p.name_ru, p.name_uz
FROM workspaces w
CROSS JOIN (VALUES
    ('Начальник департамента/отдела', 'Бўлим/Департамент бошлиғи'),
    ('PM',                            'PM'),
    ('Аналитик',                      'Таҳлилчи'),
    ('Программист и др.',             'Дастурчи ва ҳоказо'),
    ('Дизайнер',                      'Дизайнер')
) AS p(name_ru, name_uz)
WHERE w.archived_at IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM workspace_positions wp WHERE wp.workspace_id = w.id
  );
