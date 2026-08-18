import { Stepper, Step, StepLabel, Typography } from '@mui/material';

export interface StepDefinition {
  label: string;
  optional?: boolean;
}

interface IncidentFormStepperProps {
  activeStep: number;
  steps: StepDefinition[];
}

export const IncidentFormStepper: React.FC<IncidentFormStepperProps> = ({
  activeStep,
  steps,
}) => (
  <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
    {steps.map((step) => (
      <Step key={step.label}>
        <StepLabel
          optional={
            step.optional ? (
              <Typography variant="caption">Optional</Typography>
            ) : undefined
          }
        >
          {step.label}
        </StepLabel>
      </Step>
    ))}
  </Stepper>
);

export default IncidentFormStepper;
