# Jobs and the queue

A **job** is a piece of work run on a machine: a print, a cut, an engraving. A job lists what it uses, so finishing it updates your stock, your tooling and the machine's hours, and records what it cost.

![The job queue for each machine](images/queue.png)

The **Jobs** screen has four tabs:

- **Queue**: open jobs, in the order each machine will run them.
- **Requests**: jobs asked for by people outside the workshop. See [Job requests](Job-requests.md).
- **History**: finished, failed and cancelled jobs, with their cost.
- **Projects**: jobs grouped into the pieces of work they belong to, with what each cost and what it made. See [Projects](#projects).

## Create a job

1. Press **New job**.
2. Fill in:
   - **Job name**: what is being made.
   - **Machine** it runs on.
   - **Run time**: how long the machine runs. Added to the machine's hours when the job finishes.
   - **Priority**: **Urgent**, **High**, **Normal** or **Low**.
   - **Project**: the project this job is part of, if any. Shown once you have a project.
3. Under **Materials, tools and fixings**, press **Add** and pick each item the job uses, then enter how much of it. Tooling that wears (such as an endmill) also has a **Cutting time**.
4. Under **Other costs**, enter anything that is not in stock: labour, outsourcing. **Notes** is for anything else worth keeping with the job.
5. Press **Save as planned** to put it in the queue, or **Save and finish** if the work is already done.

Wrkbench shows an **Estimated cost** as you go. If a job needs more of something than you have, the form warns you, the job's row in the queue says **Short** with the items it is short of, and it appears in the [daily report](Dashboard-and-reports.md#daily-report).

## Run a job

Open a job from the queue:

- **Start** marks it as running.
- **Finish** marks it as completed.
- **Failed** marks it as failed.
- **Edit** changes the quantities if the job used more or less than planned.
- **Cancel job** drops a job that will not be run. Nothing is taken from stock, and it moves to **History** as cancelled.
- **Delete** (admins) removes the job altogether. Deleting a job that already finished does not put back the stock it used.

Starting a job on a machine that is **Ready** marks the machine **In use**; finishing, failing or cancelling the job makes it **Ready** again.

## Finish a job

When a job is finished or marked as failed, Wrkbench:

1. takes its materials out of stock,
2. adds its cutting time to each tool (see [Tool life](Inventory.md#tool-life)),
3. adds its run time to the machine (see [Maintenance](Maintenance.md)), and
4. saves its cost: **materials + tool wear + machine time + other**.

A failed run still uses its materials, so they are taken from stock too. Edit the quantities first if less was used.

Machine time is the run time multiplied by the machine's running cost per hour.

### Add material to a finished job

A finished job cannot be edited, but you can still record material it used that nobody entered. This is how you take the sheet a laser job cut, since the printer cannot tell which sheet was on the bed. Open the job in **History**, choose **Add material used**, pick the item and enter how much was used. Wrkbench takes it from stock straight away and adds its cost to the job and to its project.

## The queue

Each machine's open jobs are listed in the order they will run:

1. the running job,
2. then by priority, from urgent to low,
3. then in the order you set with the arrows,
4. then oldest first.

Start and finish times are estimated from each job's run time, back to back from now. A machine marked **Needs service** or **Offline** pauses its queue.

Operators can create, start, finish and reorder jobs. See [Members and roles](Members-and-roles.md).

## Projects

A **project** is a piece of work made up of several jobs, usually for one customer: the print, the machining and the finishing of the same order, for example. A project adds up what its jobs cost. Once you enter the price you invoiced, it shows your profit. Until then, it recommends a price.

![Projects on a board, one column per stage](images/projects.png)

The **Projects** tab is a board with one column for each stage, and a card for each project:

- **Open**: work in progress, or not invoiced yet.
- **Invoiced**: you have sent the invoice.
- **Paid**: the customer has paid.

The row above the board adds up every project: **Cost**, **Invoiced**, **Profit**, and how many are **Not priced**.

### Create a project

1. On the **Projects** tab, press **New project**.
2. Enter a **Project name** and, if you like, the **Customer** and **Notes**.
3. Press **Add project**.

### Put jobs in a project

A job can be in one project at a time. There are three ways to put it there:

- Open the project and choose the job under **Add a job**.
- Open the job and choose the project under **Project**. This works for finished jobs too.
- Choose the **Project** when you create or edit a job.

To take a job out, open the project and press the cross beside the job, or set the job's **Project** to **None**. Cancelled jobs cost nothing, so they are not offered.

### Cost, recommended price and profit

Each card shows:

- **Cost**: the cost of all the project's jobs, added together. While a job is still open its estimate is used, and the label reads **Est. cost**.
- **Recommended price**: shown until a price is entered. It is the price that would leave your **Target margin** as profit. With a cost of 60 and a target margin of 40%, the recommended price is 100, because 40% of 100 is the 40 left after costs.
- **Price** and **Profit**: shown once a price is entered. Profit is the price minus the cost. If the project cost more than its price, the card shows a **Loss** instead.

To price a project, open it and fill in:

- **Invoiced price**: what you charge for the whole project.
- **Target margin**: only if this project should use a different margin from the rest of the workspace.
- **Stage**: where the project is on the board.

The workspace's own **Target margin** is under **Settings**, **Workspace**. See [Catalogue and settings](Catalogue-and-settings.md#workspace).

### Move a project along

Drag a card to another column, or open the project and change its **Stage**. On a phone, slide the board sideways to see the other columns and use **Stage**.

A project needs an **Invoiced price** before it can be **Invoiced** or **Paid**. If you drag one without a price, it opens so you can enter it.

Deleting a project keeps its jobs; they simply no longer belong to a project.

Operators can create projects and put jobs in them. Only admins and owners can set the price, the target margin and the stage, or delete a project.
