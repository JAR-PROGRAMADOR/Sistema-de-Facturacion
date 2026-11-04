import { useState } from 'react';
import { ApiError } from '../../shared/api/error';
import { Button } from '../../shared/auth/Button';
import { useActiveCompany } from '../../shared/auth/ActiveCompanyContext';
import { Spinner } from '../../shared/ui/Spinner';
import { useToast } from '../../shared/ui/Toast';
import { useCategories, useCreateCategory, useDeleteCategory, useUpdateCategory, type Category } from './categories-api';

export function CategoriesPage() {
  const { push } = useToast();
  const { companyId, isPlatform, isLoading: companyLoading } = useActiveCompany();
  const query = useCategories(companyId, isPlatform);
  const createCategory = useCreateCategory(companyId, isPlatform);
  const updateCategory = useUpdateCategory(companyId, isPlatform);
  const deleteCategory = useDeleteCategory(companyId, isPlatform);
  const [editing, setEditing] = useState<Category | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const reset = () => { setEditing(null); setName(''); setDescription(''); };
  const edit = (category: Category) => { setEditing(category); setName(category.name); setDescription(category.description ?? ''); };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = { name: name.trim(), description: description.trim() || null };
    try {
      if (editing) {
        await updateCategory.mutateAsync({ ...input, categoryId: editing.id });
        push('success', `Categoría "${input.name}" actualizada.`);
      } else {
        await createCategory.mutateAsync(input);
        push('success', `Categoría "${input.name}" creada.`);
      }
      reset();
    } catch (error) {
      push('error', error instanceof ApiError ? error.message : 'No fue posible guardar la categoría.');
    }
  };

  const deactivate = async (category: Category) => {
    try {
      await deleteCategory.mutateAsync(category.id);
      push('success', `Categoría "${category.name}" eliminada.`);
    } catch (error) {
      push('error', error instanceof ApiError ? error.message : 'No fue posible eliminar la categoría.');
    }
  };

  if (companyLoading || query.isLoading) return <div className="center"><Spinner /></div>;
  if (!companyId) return <section className="card"><h1>Categorías</h1><p className="muted">Selecciona una empresa para gestionar categorías.</p></section>;
  if (query.isError) return <section className="card"><p className="field__error">{query.error instanceof ApiError ? query.error.message : 'No fue posible cargar categorías.'}</p></section>;

  const categories = query.data?.items ?? [];
  return (
    <div className="stack">
      <section className="card">
        <header className="page-header"><div><h1>Categorías</h1><p className="muted">Organiza el catálogo de productos</p></div></header>
        <form className="grid-2" onSubmit={submit}>
          <label className="field"><span>Nombre</span><input className="input" value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} /></label>
          <label className="field"><span>Descripción</span><input className="input" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} /></label>
          <div className="row-actions">
            {editing && <Button type="button" variant="ghost" onClick={reset}>Cancelar edición</Button>}
            <Button type="submit" disabled={createCategory.isPending || updateCategory.isPending}>{editing ? 'Guardar cambios' : 'Crear categoría'}</Button>
          </div>
        </form>
      </section>
      <section className="card">
        <h2>Listado</h2>
        {categories.length === 0 ? <p className="muted">No hay categorías.</p> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Nombre</th><th>Descripción</th><th>Estado</th><th>Acciones</th></tr></thead>
            <tbody>{categories.map((category) => (
              <tr key={category.id}>
                <td>{category.name}</td><td>{category.description || '—'}</td><td>{category.is_active ? 'Activa' : 'Inactiva'}</td>
                <td className="row-actions"><Button variant="ghost" onClick={() => edit(category)}>Editar</Button><Button variant="danger" onClick={() => void deactivate(category)} disabled={deleteCategory.isPending}>Eliminar</Button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
