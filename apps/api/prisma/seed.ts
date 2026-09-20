import { PrismaClient, Priority, Role, TaskStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
const db=new PrismaClient();
const ago=(days:number)=>new Date(Date.now()-days*864e5); const ahead=(days:number)=>new Date(Date.now()+days*864e5);
async function main(){
  await db.activity.deleteMany();await db.notification.deleteMany();await db.task.deleteMany();await db.project.deleteMany();await db.client.deleteMany();await db.refreshToken.deleteMany();await db.user.deleteMany();
  const hash=await bcrypt.hash("Password123!",12);
  const [admin,pm1,pm2,d1,d2,d3,d4]=await Promise.all([["Asha Admin","admin@velozity.test",Role.ADMIN],["Priya Manager","pm1@velozity.test",Role.PROJECT_MANAGER],["Karan Manager","pm2@velozity.test",Role.PROJECT_MANAGER],["Ravi Developer","ravi@velozity.test",Role.DEVELOPER],["Maya Developer","maya@velozity.test",Role.DEVELOPER],["Ishaan Developer","ishaan@velozity.test",Role.DEVELOPER],["Zoya Developer","zoya@velozity.test",Role.DEVELOPER]].map(([name,email,role])=>db.user.create({data:{name,email,passwordHash:hash,role:role as Role}})));
  const [acme,orbit,northstar]=await Promise.all(["Acme Retail","Orbit Health","Northstar Finance"].map(name=>db.client.create({data:{name}})));
  const projects=await Promise.all([["Acme Storefront",acme.id,pm1.id],["Orbit Patient Portal",orbit.id,pm1.id],["Northstar Analytics",northstar.id,pm2.id]].map(([name,clientId,creatorId])=>db.project.create({data:{name:name as string,clientId:clientId as string,creatorId:creatorId as string}})));
  const statuses=[TaskStatus.TODO,TaskStatus.IN_PROGRESS,TaskStatus.IN_REVIEW,TaskStatus.DONE,TaskStatus.TODO]; const users=[d1,d2,d3,d4,d1]; let taskNo=1;
  for(const project of projects)for(let i=0;i<5;i++){const overdue=taskNo===1||taskNo===6;const task=await db.task.create({data:{title:`Task #${taskNo}: ${["Discovery","Implementation","QA review","Release","Documentation"][i]}`,description:"Seeded task for assessment demonstration.",projectId:project.id,assigneeId:users[i].id,status:statuses[i],priority:[Priority.HIGH,Priority.CRITICAL,Priority.MEDIUM,Priority.LOW,Priority.HIGH][i],dueDate:overdue?ago(i+1):ahead(i+2),isOverdue:overdue}});await db.activity.create({data:{taskId:task.id,actorId:project.creatorId,previousStatus:TaskStatus.TODO,newStatus:task.status,message:`${project.creatorId===pm1.id?pm1.name:pm2.name} moved ${task.title} from TODO to ${task.status}`,createdAt:ago(i+1)}});taskNo++;}
  await db.notification.create({data:{recipientId:d1.id,title:"Welcome to Velozity",body:"You have tasks assigned to you."}});
  console.log("Seed complete. All passwords: Password123!");
}
main().finally(()=>db.$disconnect());
