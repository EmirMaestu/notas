import { listFolders, sharedListOwners } from '@/core/lists';
import { listTags } from '@/core/tags';
import { countTasks } from '@/core/tasks';
import { getDb } from '@/db';
import { AppShell } from '@/components/app-shell';
import { Sidebar } from '@/components/sidebar';
import { requireUser } from '@/lib/auth';
import { getLists } from '@/lib/data';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const db = await getDb();
  const [lists, folders, tags, owners, inbox, today] = await Promise.all([
    getLists(user.id), listFolders(db, user.id), listTags(db, user.id), sharedListOwners(db, user.id),
    countTasks(db, user.id, { view: 'inbox' }), countTasks(db, user.id, { view: 'today' }),
  ]);
  return (
    <AppShell
      user={user}
      sidebar={<Sidebar user={user} lists={lists} folders={folders} tags={tags} owners={owners} counts={{ inbox, today }} />}
    >
      {children}
    </AppShell>
  );
}
