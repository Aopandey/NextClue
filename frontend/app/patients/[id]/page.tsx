import { HealthScreen } from "@/components/screen/HealthScreen";

export default async function PatientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <HealthScreen patientId={id} />;
}
