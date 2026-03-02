import type { Schema, Struct } from '@strapi/strapi';

export interface CourseModule extends Struct.ComponentSchema {
  collectionName: 'components_course_modules';
  info: {
    displayName: 'Module';
  };
  attributes: {
    language: Schema.Attribute.Enumeration<['English', 'Hindi', 'Gujarati']> &
      Schema.Attribute.Required;
    mark_as_read: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<false>;
    module_content_type: Schema.Attribute.Enumeration<
      ['Video', 'Pdf', 'Text']
    > &
      Schema.Attribute.Required;
    module_duration_min: Schema.Attribute.Integer &
      Schema.Attribute.CustomField<
        'global::number-range',
        {
          positiveOnly: true;
          required: true;
        }
      >;
    module_id: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    pdf_file: Schema.Attribute.Media<'files', true> & Schema.Attribute.Required;
    text_content: Schema.Attribute.Blocks;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    video_file: Schema.Attribute.Media<'videos', true> &
      Schema.Attribute.Required;
  };
}

export interface CourseOrientation extends Struct.ComponentSchema {
  collectionName: 'components_course_orientations';
  info: {
    displayName: 'Orientation';
  };
  attributes: {
    orientation_flow: Schema.Attribute.Enumeration<
      ['Before Course Completion', 'After Course Completion']
    > &
      Schema.Attribute.Required;
    topics_to_cover: Schema.Attribute.Blocks & Schema.Attribute.Required;
    trainer_name: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface FeedbackFormAnswer extends Struct.ComponentSchema {
  collectionName: 'components_feedback_form_answers';
  info: {
    displayName: 'Answer';
  };
  attributes: {
    answer: Schema.Attribute.String & Schema.Attribute.Required;
    answer_type: Schema.Attribute.Enumeration<
      ['Rating', 'Text', 'AgreeOrDisagree', 'YesOrNo']
    > &
      Schema.Attribute.Required;
    question: Schema.Attribute.String & Schema.Attribute.Required;
    question_id: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface FeedbackFormFeedbackForm extends Struct.ComponentSchema {
  collectionName: 'components_feedback_form_feedback_forms';
  info: {
    displayName: 'Feedback Form';
  };
  attributes: {
    compulsory: Schema.Attribute.Boolean &
      Schema.Attribute.CustomField<
        'global::yes-no-toggle',
        {
          required: true;
        }
      >;
    feedback_question: Schema.Attribute.Component<
      'feedback-form.question',
      true
    >;
    language: Schema.Attribute.Enumeration<['Hindi', 'English', 'Gujarati']> &
      Schema.Attribute.Required;
  };
}

export interface FeedbackFormQuestion extends Struct.ComponentSchema {
  collectionName: 'components_feedback_form_questions';
  info: {
    displayName: 'Question';
  };
  attributes: {
    answer_type: Schema.Attribute.Enumeration<
      ['Rating', 'Text', 'AgreeOrDisagree', 'YesNo']
    > &
      Schema.Attribute.Required;
    mandatory: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<true>;
    qestion: Schema.Attribute.String & Schema.Attribute.Required;
    question_id: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
  };
}

export interface QuizAnswer extends Struct.ComponentSchema {
  collectionName: 'components_quiz_answers';
  info: {
    displayName: 'Answer';
  };
  attributes: {
    correct: Schema.Attribute.Boolean;
    point: Schema.Attribute.Integer;
    question: Schema.Attribute.String & Schema.Attribute.Required;
    question_id: Schema.Attribute.String & Schema.Attribute.Required;
    question_type: Schema.Attribute.Enumeration<
      ['Multiple_choice', 'Multiple_select']
    > &
      Schema.Attribute.Required;
    selected_answer_for_multiChoice: Schema.Attribute.String &
      Schema.Attribute.Required;
    selected_answer_for_multiSelect: Schema.Attribute.JSON;
  };
}

export interface QuizChecklist extends Struct.ComponentSchema {
  collectionName: 'components_quiz_checklists';
  info: {
    displayName: 'Checklist';
  };
  attributes: {
    discription: Schema.Attribute.Text;
  };
}

export interface QuizMultiselectQuestionAnswer extends Struct.ComponentSchema {
  collectionName: 'components_quiz_multiselect_question_answers';
  info: {
    displayName: 'Multiselect question answer';
  };
  attributes: {
    answer: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface QuizOptions extends Struct.ComponentSchema {
  collectionName: 'components_quiz_options';
  info: {
    displayName: 'Quiz question options';
  };
  attributes: {
    option_key: Schema.Attribute.String & Schema.Attribute.Required;
    option_label: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface QuizQuestion extends Struct.ComponentSchema {
  collectionName: 'components_quiz_questions';
  info: {
    displayName: 'Question';
  };
  attributes: {
    correct_answer: Schema.Attribute.String & Schema.Attribute.Required;
    correct_multiSelect_answers: Schema.Attribute.Component<
      'quiz.multiselect-question-answer',
      true
    > &
      Schema.Attribute.Required;
    options: Schema.Attribute.Component<'quiz.options', true>;
    order: Schema.Attribute.Integer;
    point: Schema.Attribute.Integer &
      Schema.Attribute.CustomField<
        'global::number-range',
        {
          min: '1';
          positiveOnly: true;
        }
      >;
    question_id: Schema.Attribute.String & Schema.Attribute.Required;
    question_text: Schema.Attribute.Text & Schema.Attribute.Required;
    question_type: Schema.Attribute.Enumeration<
      ['Multiple_choice', 'Multiple_select']
    > &
      Schema.Attribute.Required;
  };
}

export interface QuizQuiz extends Struct.ComponentSchema {
  collectionName: 'components_quiz_quizzes';
  info: {
    displayName: 'Quiz';
  };
  attributes: {
    completion_time: Schema.Attribute.Integer &
      Schema.Attribute.CustomField<'global::number-range'>;
    compulsory: Schema.Attribute.Boolean &
      Schema.Attribute.CustomField<
        'global::yes-no-toggle',
        {
          required: true;
        }
      >;
    language: Schema.Attribute.Enumeration<['English', 'Hindi', 'Gujarati']> &
      Schema.Attribute.Required;
    max_attempt: Schema.Attribute.Integer &
      Schema.Attribute.CustomField<'global::number-range'>;
    quiz_id: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    quiz_instruction: Schema.Attribute.Component<
      'quiz.quiz-instruction',
      true
    > &
      Schema.Attribute.Required;
    quiz_instruction_checklist: Schema.Attribute.Component<
      'quiz.checklist',
      true
    > &
      Schema.Attribute.Required;
    quiz_questions: Schema.Attribute.Component<'quiz.question', true> &
      Schema.Attribute.Required;
    title: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface QuizQuizInstruction extends Struct.ComponentSchema {
  collectionName: 'components_quiz_quiz_instructions';
  info: {
    displayName: 'Quiz instruction';
  };
  attributes: {
    description: Schema.Attribute.Text;
    icon: Schema.Attribute.JSON &
      Schema.Attribute.CustomField<
        'plugin::strapi-plugin-iconhub.iconhub',
        {
          storeIconData: true;
          storeIconName: true;
        }
      >;
    name: Schema.Attribute.String;
  };
}

export interface RoutesBusRoute extends Struct.ComponentSchema {
  collectionName: 'components_routes_bus_routes';
  info: {
    displayName: 'Bus route';
  };
  attributes: {
    address: Schema.Attribute.String & Schema.Attribute.Required;
    contact: Schema.Attribute.String & Schema.Attribute.Required;
    hr_manager: Schema.Attribute.String;
    map_link: Schema.Attribute.String & Schema.Attribute.Required;
    routes: Schema.Attribute.Component<'routes.bus-stop', true>;
    site_manager: Schema.Attribute.String;
    unit_id: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    unit_img: Schema.Attribute.Media<'images'> & Schema.Attribute.Required;
    unit_name: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface RoutesBusStop extends Struct.ComponentSchema {
  collectionName: 'components_routes_bus_stops';
  info: {
    displayName: 'Bus stop';
  };
  attributes: {
    bus_sifts: Schema.Attribute.Component<'routes.sift', true> &
      Schema.Attribute.Required;
    route_id: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    route_name: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface RoutesSift extends Struct.ComponentSchema {
  collectionName: 'components_routes_sifts';
  info: {
    displayName: 'Sift';
  };
  attributes: {
    sift_name: Schema.Attribute.String & Schema.Attribute.Required;
    sift_time: Schema.Attribute.Time & Schema.Attribute.Required;
  };
}

export interface SharedRequiredToggle extends Struct.ComponentSchema {
  collectionName: 'components_shared_required_toggles';
  info: {
    description: 'Reusable boolean toggle (Yes/No) with required validation. Use in any content-type schema.';
    displayName: 'Yes/No Toggle (Required)';
  };
  attributes: {
    value: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<false>;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'course.module': CourseModule;
      'course.orientation': CourseOrientation;
      'feedback-form.answer': FeedbackFormAnswer;
      'feedback-form.feedback-form': FeedbackFormFeedbackForm;
      'feedback-form.question': FeedbackFormQuestion;
      'quiz.answer': QuizAnswer;
      'quiz.checklist': QuizChecklist;
      'quiz.multiselect-question-answer': QuizMultiselectQuestionAnswer;
      'quiz.options': QuizOptions;
      'quiz.question': QuizQuestion;
      'quiz.quiz': QuizQuiz;
      'quiz.quiz-instruction': QuizQuizInstruction;
      'routes.bus-route': RoutesBusRoute;
      'routes.bus-stop': RoutesBusStop;
      'routes.sift': RoutesSift;
      'shared.required-toggle': SharedRequiredToggle;
    }
  }
}
