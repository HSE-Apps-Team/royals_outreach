import PageTitle from "@/app/components/pageTitle";
import CategoryProgress from "@/app/components/categoryProgress";
import EmptyState from "@/app/components/emptyState";
import "@/app/css/student.css";
import type { ClubGoalProgress } from "@/actions/hours";

type GoalProgressUIProps = {
  clubs: ClubGoalProgress[];
};

export default function GoalProgressUI({ clubs }: GoalProgressUIProps) {
  return (
    <div className="goal-progress">
      <PageTitle align="left" subtitle="Hours earned in each club and your progress toward every goal." style={{ margin: 0 }}>
        Goal Progress
      </PageTitle>

      {clubs.length === 0 ? (
        <EmptyState icon="bullseye" message="You are not in any clubs yet." />
      ) : (
        clubs.map((club) => (
          <CategoryProgress
            key={club.clubId}
            name={club.clubName}
            earned={club.earned}
            goal={club.goal}
            pending={club.pending}
            categories={club.categories}
            line={club.noHoursNeeded ? "As an exec, you do not need hours in this club." : undefined}
          />
        ))
      )}
    </div>
  );
}
