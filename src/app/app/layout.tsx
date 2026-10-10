import { listFolders } from '@/core/lists';
import { listTags } from '@/core/tags';
import { getDb } from '@/db';
import { AppShell } from '@/components/app-shell';
import { Sidebar } from '@/components/sidebar';
import { requireUser } from '@/lib/auth';
import { getLists } from '@/lib/data';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const db = await getDb();
  const [lists, folders, tags] = await Promise.all([
    getLists(user.id), listFolders(db, user.id), listTags(db, user.id),
  ]);
  return (
    <AppShell sidebar={<Sidebar user={user} lists={lists} folders={folders} tags={tags} />}>
      {children}
    </AppShell>
  );
}
